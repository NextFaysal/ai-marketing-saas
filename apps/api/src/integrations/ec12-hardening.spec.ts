import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { encryptJson, decryptJson } from "./crypto";

// In-memory fakes (same makeTable pattern as ec2-connection.spec.ts),
// except deleteMany reports a count like real Prisma.
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => v === undefined || row[k] === v);
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: data.id ?? `id-${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.integrationId ?? where.id;
      const field = where.integrationId ? "integrationId" : "id";
      const existing = rows.find((r) => r[field] === key);
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `id-${++seq}`, ...create }; rows.push(row); return row;
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable(), productVariant: makeTable(), customer: makeTable(),
    order: makeTable(), orderItem: makeTable(), store: makeTable(),
    integration: makeTable(), syncJob: makeTable(),
    integrationCredential: makeTable(), webhookEvent: makeTable(),
    storeListing: makeTable(), storeDiscountSync: makeTable(),
    syncOutbox: makeTable(), customerStoreIdentity: makeTable(),
    storeDiscount: makeTable(),
  };
}

const auditLogs: any[] = [];
const audit = { log: async (input: any) => { auditLogs.push(input); } } as any;

const originalFetch = globalThis.fetch;
const originalPublicUrl = process.env.API_PUBLIC_URL;

beforeEach(() => { auditLogs.length = 0; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPublicUrl === undefined) delete process.env.API_PUBLIC_URL; else process.env.API_PUBLIC_URL = originalPublicUrl;
});

function jsonResponse(status: number, body: any) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, headers: new Headers(),
    json: async () => JSON.parse(text), text: async () => text,
  };
}

const OLD_SECRET = "old-webhook-secret-0123456789";
const DELIVERY_URL = "https://api.example.com/webhooks/woocommerce/int-woo";

function seedWoo(prisma: any) {
  const secrets = { consumerKey: "ck_live_1", consumerSecret: "cs_live_1", webhookSecret: OLD_SECRET };
  const encryptedData = encryptJson(secrets);
  prisma.store.rows.push({ id: "store-1", organizationId: "org-1", url: "https://shop.example.com", currency: "BDT" });
  prisma.integration.rows.push({
    id: "int-woo", organizationId: "org-1", provider: "woocommerce", storeId: "store-1", status: "CONNECTED",
    store: { id: "store-1", organizationId: "org-1", url: "https://shop.example.com", currency: "BDT" },
    credential: { encryptedData },
  });
  prisma.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-woo", encryptedData });
}

function storedSecrets(prisma: any) {
  return decryptJson<any>(prisma.integrationCredential.rows.find((r: any) => r.integrationId === "int-woo").encryptedData);
}

describe("EC12 Woo webhook secret rotation", () => {
  it("(a) rotates the stored secret, deletes our old webhooks, re-registers with the NEW secret, secret never audited", async () => {
    process.env.API_PUBLIC_URL = "https://api.example.com";
    const prisma = fakePrisma();
    seedWoo(prisma);
    let webhooks: any[] = [
      { id: 55, topic: "order.created", delivery_url: DELIVERY_URL },
      { id: 56, topic: "order.created", delivery_url: "https://someone-else.example.com/hook" },
    ];
    const createdPayloads: any[] = [];
    const deletedIds: any[] = [];
    globalThis.fetch = (async (url: any, init: any = {}) => {
      const u = String(url);
      const method = init.method ?? "GET";
      if (u.includes("/wp-json/wc/v3/webhooks")) {
        if (method === "DELETE") {
          const id = Number(u.match(/webhooks\/(\d+)/)?.[1]);
          deletedIds.push(id);
          webhooks = webhooks.filter((w) => w.id !== id);
          return jsonResponse(200, {});
        }
        if (method === "POST") {
          const payload = JSON.parse(init.body);
          createdPayloads.push(payload);
          const wh = { id: 100 + createdPayloads.length, topic: payload.topic, delivery_url: payload.delivery_url };
          webhooks.push(wh);
          return jsonResponse(201, wh);
        }
        return jsonResponse(200, webhooks);
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;

    const svc = new IntegrationsService(prisma as any, audit);
    const out: any = await svc.rotateWooWebhookSecret("org-1", "user-1", "int-woo");
    expect(out.rotated).toBe(true);
    expect(out.webhookRegistration).toBe("registered");

    const after = storedSecrets(prisma);
    expect(after.webhookSecret).not.toBe(OLD_SECRET);
    expect(typeof after.webhookSecret).toBe("string");
    expect(after.webhookSecret.length).toBe(48);
    expect(after.consumerKey).toBe("ck_live_1");
    expect(after.consumerSecret).toBe("cs_live_1");

    // Our old webhook was deleted; the foreign one was NOT touched.
    expect(deletedIds).toEqual([55]);
    expect(webhooks.some((w) => w.id === 56)).toBe(true);

    // All 5 topics re-created carrying the NEW secret.
    expect(createdPayloads).toHaveLength(5);
    for (const p of createdPayloads) {
      expect(p.secret).toBe(after.webhookSecret);
      expect(p.delivery_url).toBe(DELIVERY_URL);
    }

    const rotateLog = auditLogs.find((l) => l.action === "integration.webhook_secret_rotated");
    expect(rotateLog).toBeTruthy();
    expect(rotateLog.metadata.webhookRegistration).toBe("registered");
    const allAudit = JSON.stringify(auditLogs);
    expect(allAudit).not.toContain(after.webhookSecret);
    expect(allAudit).not.toContain(OLD_SECRET);
    expect(JSON.stringify(out)).not.toContain(after.webhookSecret);
  });

  it("(b) without API_PUBLIC_URL the secret still rotates; registration recorded as skipped_no_public_url", async () => {
    delete process.env.API_PUBLIC_URL;
    const prisma = fakePrisma();
    seedWoo(prisma);
    globalThis.fetch = (async () => { throw new Error("no fetch expected"); }) as any;
    const svc = new IntegrationsService(prisma as any, audit);
    const out: any = await svc.rotateWooWebhookSecret("org-1", "user-1", "int-woo");
    expect(out.rotated).toBe(true);
    expect(out.webhookRegistration).toBe("skipped_no_public_url");
    const after = storedSecrets(prisma);
    expect(after.webhookSecret).not.toBe(OLD_SECRET);
    expect(after.consumerKey).toBe("ck_live_1");
    expect(prisma.integration.rows[0].webhookStatus?.status).toBe("skipped_no_public_url");
    expect(prisma.integration.rows[0].webhookStatus?.rotatedAt).toBe(out.rotatedAt);
  });

  it("(c) service-level rotation of a Shopify integration is a BadRequest (controller maps shopify separately)", async () => {
    const prisma = fakePrisma();
    prisma.integration.rows.push({
      id: "int-shop", organizationId: "org-1", provider: "shopify", storeId: "store-1", status: "CONNECTED",
      store: { id: "store-1", url: "https://test.myshopify.com" },
      credential: { encryptedData: encryptJson({ accessToken: "shpat_x", apiSecret: "s" }) },
    });
    const svc = new IntegrationsService(prisma as any, audit);
    await expect(svc.rotateWooWebhookSecret("org-1", "user-1", "int-shop")).rejects.toMatchObject({ code: "integrations.webhookSecretRotationIsOnlyAvailable" });
  });
});

describe("EC12 disconnect purge policy", () => {
  function seedDisconnect(prisma: any) {
    seedWoo(prisma);
    prisma.store.rows.push({ id: "store-2", organizationId: "org-1", url: "https://other.example.com", currency: "BDT" });
    prisma.storeListing.rows.push(
      { id: "lst-1", organizationId: "org-1", storeId: "store-1", productId: "prod-1", externalId: "42" },
      { id: "lst-2", organizationId: "org-1", storeId: "store-2", productId: "prod-1", externalId: "43" },
    );
    prisma.storeDiscountSync.rows.push(
      { id: "ds-1", organizationId: "org-1", discountId: "disc-1", storeId: "store-1" },
      { id: "ds-2", organizationId: "org-1", discountId: "disc-1", storeId: "store-2" },
    );
    prisma.syncOutbox.rows.push(
      { id: "ob-1", organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "prod-1" },
      { id: "ob-2", organizationId: "org-1", storeId: "store-2", entityType: "product", entityId: "prod-1" },
    );
    prisma.customerStoreIdentity.rows.push(
      { id: "ci-1", organizationId: "org-1", storeId: "store-1", customerId: "cust-1", externalId: "7" },
      { id: "ci-2", organizationId: "org-1", storeId: "store-2", customerId: "cust-1", externalId: "8" },
    );
    prisma.product.rows.push({ id: "prod-1", organizationId: "org-1", name: "Shirt" });
    prisma.order.rows.push({ id: "ord-1", organizationId: "org-1", storeId: "store-1" });
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1" });
    prisma.storeDiscount.rows.push({ id: "disc-1", organizationId: "org-1", code: "EID10" });
  }

  it("(d) default disconnect (no opts): mappings + business data all kept, purge.requested false", async () => {
    const prisma = fakePrisma();
    seedDisconnect(prisma);
    const svc = new IntegrationsService(prisma as any, audit);
    const out: any = await svc.disconnect("org-1", "user-1", "int-woo");
    expect(out.status).toBe("DISCONNECTED");
    expect(out.purge).toEqual({ requested: false });
    expect(prisma.storeListing.rows).toHaveLength(2);
    expect(prisma.storeDiscountSync.rows).toHaveLength(2);
    expect(prisma.syncOutbox.rows).toHaveLength(2);
    expect(prisma.customerStoreIdentity.rows).toHaveLength(2);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
    expect(auditLogs.some((l) => l.action === "integration.disconnect_purge")).toBe(false);
  });

  it("(e) purge by OWNER deletes ONLY the target store's mapping rows; business records intact; counts itemized", async () => {
    const prisma = fakePrisma();
    seedDisconnect(prisma);
    const svc = new IntegrationsService(prisma as any, audit);
    const out: any = await svc.disconnect("org-1", "user-1", "int-woo", { purgeMappings: true, actorRole: "OWNER" });
    expect(out.status).toBe("DISCONNECTED");
    expect(out.purge.requested).toBe(true);
    expect(out.purge.deleted).toEqual({ listings: 1, discountSyncs: 1, outbox: 1, customerIdentities: 1 });
    expect(out.purge.kept).toContain("Product records");
    // Only store-1 rows gone; store-2 rows untouched.
    expect(prisma.storeListing.rows.map((r: any) => r.id)).toEqual(["lst-2"]);
    expect(prisma.storeDiscountSync.rows.map((r: any) => r.id)).toEqual(["ds-2"]);
    expect(prisma.syncOutbox.rows.map((r: any) => r.id)).toEqual(["ob-2"]);
    expect(prisma.customerStoreIdentity.rows.map((r: any) => r.id)).toEqual(["ci-2"]);
    // Business data intact.
    expect(prisma.product.rows).toHaveLength(1);
    expect(prisma.order.rows).toHaveLength(1);
    expect(prisma.customer.rows).toHaveLength(1);
    expect(prisma.storeDiscount.rows).toHaveLength(1);
    expect(prisma.store.rows).toHaveLength(2);
    const purgeLog = auditLogs.find((l) => l.action === "integration.disconnect_purge");
    expect(purgeLog.metadata.deleted).toEqual({ listings: 1, discountSyncs: 1, outbox: 1, customerIdentities: 1 });
  });

  it("(f) purge requested by ADMIN: Forbidden, integration stays CONNECTED, nothing deleted", async () => {
    const prisma = fakePrisma();
    seedDisconnect(prisma);
    const svc = new IntegrationsService(prisma as any, audit);
    await expect(svc.disconnect("org-1", "user-1", "int-woo", { purgeMappings: true, actorRole: "ADMIN" }))
      .rejects.toMatchObject({ code: "integrations.onlyTheOrganizationOwnerCanPurge" });
    expect(prisma.integration.rows[0].status).toBe("CONNECTED");
    expect(prisma.integrationCredential.rows).toHaveLength(1);
    expect(prisma.storeListing.rows).toHaveLength(2);
    expect(prisma.syncOutbox.rows).toHaveLength(2);
    expect(auditLogs).toHaveLength(0);
  });
});
