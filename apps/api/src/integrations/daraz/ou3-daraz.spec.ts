import {
  DARAZ_NOT_LIVE_MESSAGE,
  DarazDevAdapterClient,
  DarazDevAdapterError,
  signDarazRequest,
} from "./daraz.client";
import { DARAZ_CONFIG_STATUS, DarazService } from "./daraz.service";
import { decryptJson } from "../crypto";
import { CommerceAdapterRegistry, DarazAdapter } from "../commerce/adapters";

/**
 * OU3 — Daraz development adapter: the evidenced sign contract,
 * the honest refusals, the sealed-but-unverified config surface
 * and the registry gating. No test here may ever observe a
 * network call, a "connected" state or a verified:true.
 */

describe("signDarazRequest (evidenced shared-stack algorithm)", () => {
  it("matches a hand-computed HMAC-SHA256 vector (sorted params, sign + empties excluded, path prefixed)", () => {
    const sign = signDarazRequest(
      "/product/create",
      {
        timestamp: "1700000000000",
        app_key: "12345",
        sign_method: "sha256",
        access_token: "tok123",
        sign: "SHOULD_BE_EXCLUDED",
        empty: "",
      },
      "testsecret",
    );
    // base string: /product/create + access_tokentok123 +
    // app_key12345 + sign_methodsha256 + timestamp1700000000000
    expect(sign).toBe("F2A5DD0CEA93FF8FE836E5C51445A7DBAF922487153ADFB842F6D2EA7D0840C1");
  });

  it("appends the request body after the parameters when present", () => {
    const withBody = signDarazRequest("/product/create", { app_key: "1" }, "s", "<xml/>");
    const without = signDarazRequest("/product/create", { app_key: "1" }, "s");
    expect(withBody).not.toBe(without);
  });
});

describe("DarazDevAdapterClient (development adapter)", () => {
  it("is marked developmentAdapter and not live", () => {
    const client = new DarazDevAdapterClient({ appKey: "k", appSecret: "s" });
    expect(client.developmentAdapter).toBe(true);
    expect(client.live).toBe(false);
  });

  it("refuses every operation with the honest not-live message and never calls fetch", async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error("network must never be called");
    }) as any;
    const client = new DarazDevAdapterClient({ appKey: "k", appSecret: "s" }, fetchFn);
    await expect(client.verify()).rejects.toBeInstanceOf(DarazDevAdapterError);
    await expect(client.verify()).rejects.toThrow(DARAZ_NOT_LIVE_MESSAGE);
    await expect(client.getProducts()).rejects.toBeInstanceOf(DarazDevAdapterError);
    await expect(client.createProduct({})).rejects.toBeInstanceOf(DarazDevAdapterError);
    await expect(client.updateProduct({})).rejects.toBeInstanceOf(DarazDevAdapterError);
    await expect(client.getOrders()).rejects.toBeInstanceOf(DarazDevAdapterError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ---------- DarazService over an in-memory Prisma fake ----------

function fakePrisma() {
  const integrations: any[] = [];
  const credentials = new Map<string, any>();
  let seq = 0;
  return {
    _integrations: integrations,
    _credentials: credentials,
    integration: {
      findMany: async ({ where }: any) =>
        integrations.filter((r) => r.organizationId === where.organizationId && r.provider === where.provider)
          .map((r) => ({ ...r, credential: credentials.get(r.id) ?? null })),
      create: async ({ data }: any) => {
        const row = { id: `int-${++seq}`, createdAt: new Date(), ...data };
        integrations.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = integrations.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        const i = integrations.findIndex((r) => r.id === where.id);
        const [row] = integrations.splice(i, 1);
        return row;
      },
    },
    integrationCredential: {
      create: async ({ data }: any) => {
        const row = { id: `cred-${++seq}`, ...data };
        credentials.set(data.integrationId, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = credentials.get(where.integrationId);
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        credentials.delete(where.integrationId);
        return {};
      },
    },
  };
}

describe("DarazService config surface (sealed, unverified, never connected)", () => {
  it("starts unconfigured and not live", async () => {
    const svc = new DarazService(fakePrisma() as any);
    const cfg = await svc.getConfig("org-1");
    expect(cfg.configured).toBe(false);
    expect(cfg.live).toBe(false);
    expect(cfg.connected).toBe(false);
    expect(cfg.verified).toBe(false);
  });

  it("saveConfig seals the secret, keeps status DISCONNECTED, and reports verified:false", async () => {
    const prisma = fakePrisma();
    const svc = new DarazService(prisma as any);
    const out = await svc.saveConfig("org-1", "user-1", {
      appKey: "appkey-1",
      appSecret: "supersecret",
      accessToken: "tok-1",
    });
    expect(out.configured).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.connected).toBe(false);
    expect(out.live).toBe(false);
    expect(out.configStatus).toBe(DARAZ_CONFIG_STATUS);
    expect(out.appKey).toBe("appkey-1");
    expect(out.hasAppSecret).toBe(true);
    // The secret never appears in any response payload.
    expect(JSON.stringify(out)).not.toContain("supersecret");
    expect(JSON.stringify(out)).not.toContain("tok-1");
    // Stored row: DISCONNECTED, credential sealed (decryptable
    // only via the crypto layer, not plaintext anywhere).
    expect(prisma._integrations).toHaveLength(1);
    expect(prisma._integrations[0].status).toBe("DISCONNECTED");
    expect(prisma._integrations[0].provider).toBe("daraz");
    const stored = prisma._credentials.get(prisma._integrations[0].id);
    expect(stored.encryptedData).not.toContain("supersecret");
    const plain = decryptJson<any>(stored.encryptedData);
    expect(plain.appSecret).toBe("supersecret");
    expect(plain.configStatus).toBe(DARAZ_CONFIG_STATUS);
    // Verification ran and honestly failed.
    expect(out.verification.verified).toBe(false);
    expect(out.verification.reason).toContain("Daraz");
  });

  it("saveConfig requires appKey + appSecret", async () => {
    const svc = new DarazService(fakePrisma() as any);
    await expect(svc.saveConfig("org-1", "u", { appKey: "k" })).rejects.toThrow();
    await expect(svc.saveConfig("org-1", "u", { appSecret: "s" })).rejects.toThrow();
  });

  it("verify() never returns verified:true and saves nothing new", async () => {
    const prisma = fakePrisma();
    const svc = new DarazService(prisma as any);
    const before = await svc.verify("org-1");
    expect(before.verified).toBe(false);
    await svc.saveConfig("org-1", "u", { appKey: "k", appSecret: "s" });
    const after = await svc.verify("org-1");
    expect(after.verified).toBe(false);
    expect(after.live).toBe(false);
    expect(prisma._integrations[0].status).toBe("DISCONNECTED");
  });

  it("removeConfig deletes the row and its sealed credential", async () => {
    const prisma = fakePrisma();
    const svc = new DarazService(prisma as any);
    await svc.saveConfig("org-1", "u", { appKey: "k", appSecret: "s" });
    await svc.removeConfig("org-1", "u");
    expect(prisma._integrations).toHaveLength(0);
    expect(prisma._credentials.size).toBe(0);
    expect((await svc.getConfig("org-1")).configured).toBe(false);
  });
});

describe("DarazAdapter in the EC1 registry (gating)", () => {
  it("is registered with every capability false", () => {
    const registry = new CommerceAdapterRegistry(undefined as any);
    const caps = registry.capabilitiesFor("daraz");
    expect(Object.keys(caps).length).toBeGreaterThan(0);
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
  });

  it("execute() refuses every operation with the not-live reason", async () => {
    const adapter = new DarazAdapter();
    for (const operation of ["push_product", "push_order_status", "register_webhooks", "anything"]) {
      const out = await adapter.execute({
        organizationId: "org-1",
        store: {},
        operation,
        payload: {},
      });
      expect(out.ok).toBe(false);
      expect(out.error).toBe(DARAZ_NOT_LIVE_MESSAGE);
    }
  });
});
