process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "gb9-test-secret";

import { createHmac } from "node:crypto";
import { WebhooksOutgoingService } from "./webhooks-outgoing.service";
import { validateWebhookUrl } from "./webhook-url";
import { EventsService } from "../common/events.service";
import { unseal } from "../common/platform-config";

/**
 * GB9 (GC23) — outgoing webhooks. Pinned rules:
 * (a) the signing secret is returned EXACTLY ONCE (create /
 *     rotate), stored sealed, never present in list/get payloads;
 * (b) SSRF: non-https, literal private IPs, localhost and any
 *     hostname resolving to a private/reserved address (even one
 *     record among public ones) are refused at create AND
 *     re-checked at delivery time (DNS is mocked throughout);
 * (c) order.created fan-out dedupes the paired bus events
 *     (order.ingested + order.created) into ONE delivery;
 * (d) payloads are PII-minimal — no customer name/phone/address
 *     even when the order row carries them;
 * (e) delivery: 2xx → delivered with the HMAC signature header;
 *     failures follow 1m → 5m → 30m → 2h and cap at failed after
 *     5 attempts; resend reuses the same delivery row.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true; // nested operator objects other than `in` treated leniently
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
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), attempts: 0, ...data };
      rows.push(row);
      return row;
    },
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
  };
}

const PUBLIC_DNS = async (_host: string) => [{ address: "93.184.216.34", family: 4 }];
const PRIVATE_DNS = async (_host: string) => [{ address: "10.0.0.5", family: 4 }];
const MIXED_DNS = async (_host: string) => [
  { address: "93.184.216.34", family: 4 },
  { address: "169.254.169.254", family: 4 },
];

function build() {
  const tables: any = {
    webhookSubscription: makeTable("sub"),
    webhookDelivery: makeTable("del"),
    order: makeTable("order"),
  };
  const prisma: any = { ...tables };
  const audit = { log: jest.fn(async () => undefined) };
  const events = new EventsService();
  const svc = new WebhooksOutgoingService(prisma, audit as any, events);
  svc.lookupFn = PUBLIC_DNS;
  return { svc, tables, audit, events, prisma };
}

async function seedOrder(tables: any, over: any = {}) {
  return tables.order.create({
    data: {
      id: "order-1", organizationId: "org-1", externalNumber: "WC-1001",
      status: "processing", source: "woocommerce", totalMinor: 150000n,
      currency: "BDT", items: [{ quantity: 2 }, { quantity: 1 }],
      // PII that must NEVER reach a webhook payload:
      customerName: "Rahim Uddin", customerPhone: "01711111111", address: "House 1, Khulna",
      ...over,
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("GB9 webhooks — subscription CRUD + secret-once", () => {
  it("create returns the secret once, sealed at rest; list/get never expose it", async () => {
    const { svc, tables } = build();
    const created: any = await svc.createSubscription("org-1", "user-1", {
      url: "https://hooks.example.com/orders", events: ["order.created"],
    });
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(created.secretShownOnce).toBe(true);
    expect(created.secretSet).toBe(true);
    const stored = tables.webhookSubscription.rows[0];
    expect(stored.secretSealed).not.toContain(created.secret);
    expect(unseal(stored.secretSealed)).toBe(created.secret);

    const listed: any = await svc.listSubscriptions("org-1");
    expect(listed).toHaveLength(1);
    expect(listed[0].secret).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    const got: any = await svc.getSubscription("org-1", created.id);
    expect(got.secret).toBeUndefined();
    expect(got.secretSet).toBe(true);
  });

  it("rotate issues a NEW secret, shown once; the old one no longer unseals", async () => {
    const { svc, tables } = build();
    const created: any = await svc.createSubscription("org-1", "user-1", {
      url: "https://hooks.example.com/orders", events: ["order.created"],
    });
    const rotated: any = await svc.rotateSecret("org-1", "user-1", created.id);
    expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.secretShownOnce).toBe(true);
    expect(unseal(tables.webhookSubscription.rows[0].secretSealed)).toBe(rotated.secret);
  });

  it("foreign-org ids 404 for get / update / rotate / delete", async () => {
    const { svc } = build();
    const created: any = await svc.createSubscription("org-1", "user-1", {
      url: "https://hooks.example.com/orders", events: ["order.created"],
    });
    await expect(svc.getSubscription("org-2", created.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.updateSubscription("org-2", "u", created.id, { active: false })).rejects.toMatchObject({ status: 404 });
    await expect(svc.rotateSecret("org-2", "u", created.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.deleteSubscription("org-2", "u", created.id)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects unknown events and an empty event list", async () => {
    const { svc } = build();
    await expect(svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.shipped"],
    })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: [],
    })).rejects.toMatchObject({ status: 400 });
  });

  it("create / rotate / delete are audited", async () => {
    const { svc, audit } = build();
    const created: any = await svc.createSubscription("org-1", "user-1", {
      url: "https://hooks.example.com/orders", events: ["order.paid"],
    });
    await svc.rotateSecret("org-1", "user-1", created.id);
    await svc.deleteSubscription("org-1", "user-1", created.id);
    const actions = audit.log.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual([
      "webhooks.subscription_created",
      "webhooks.subscription_secret_rotated",
      "webhooks.subscription_deleted",
    ]);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain(created.secret);
  });
});

describe("GB9 webhooks — SSRF screen", () => {
  it("validateWebhookUrl refuses non-https, localhost and literal private IPs", async () => {
    expect((await validateWebhookUrl("http://hooks.example.com/x", PUBLIC_DNS)).ok).toBe(false);
    expect((await validateWebhookUrl("https://localhost/x", PUBLIC_DNS)).ok).toBe(false);
    expect((await validateWebhookUrl("https://127.0.0.1/x", PUBLIC_DNS)).ok).toBe(false);
    expect((await validateWebhookUrl("https://192.168.1.10/x", PUBLIC_DNS)).ok).toBe(false);
    expect((await validateWebhookUrl("https://[::1]/x", PUBLIC_DNS)).ok).toBe(false);
    expect((await validateWebhookUrl("https://[::ffff:10.0.0.9]/x", PUBLIC_DNS)).ok).toBe(false);
    expect((await validateWebhookUrl("https://hooks.example.com/x", PUBLIC_DNS)).ok).toBe(true);
  });

  it("create refuses a hostname resolving to a private address — even one record among public ones", async () => {
    const { svc } = build();
    svc.lookupFn = PRIVATE_DNS;
    await expect(svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.created"],
    })).rejects.toMatchObject({ status: 400 });
    svc.lookupFn = MIXED_DNS;
    await expect(svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.created"],
    })).rejects.toMatchObject({ status: 400 });
  });

  it("delivery re-checks DNS: a hostnames that turns private is never fetched", async () => {
    const { svc, tables } = build();
    const created: any = await svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.created"],
    });
    const delivery = await tables.webhookDelivery.create({
      data: {
        subscriptionId: created.id, organizationId: "org-1", event: "order.created",
        payload: { event: "order.created" }, status: "pending", nextRetryAt: new Date(),
      },
    });
    let fetchCalls = 0;
    svc.fetchFn = async () => { fetchCalls++; return { status: 200 }; };
    svc.lookupFn = PRIVATE_DNS; // DNS changed after creation
    const outcome = await svc.attemptDelivery(delivery);
    expect(outcome).toBe("retry");
    expect(fetchCalls).toBe(0);
    expect(tables.webhookDelivery.rows[0].error).toContain("re-validation");
  });
});

describe("GB9 webhooks — event fan-out", () => {
  it("order.ingested + order.created for one order produce exactly ONE delivery, PII-free", async () => {
    const { svc, tables, events } = build();
    await seedOrder(tables);
    await svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.created"],
    });
    // Both creation sites fire both bus events for one order.
    events.emit("order.ingested", { organizationId: "org-1", context: { orderId: "order-1", source: "woocommerce" } });
    events.emit("order.created", { organizationId: "org-1", context: { orderId: "order-1" } });
    await sleep(120);
    const rows = tables.webhookDelivery.rows;
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload;
    expect(payload.event).toBe("order.created");
    expect(payload.organizationId).toBe("org-1");
    expect(payload.data).toEqual({
      orderId: "order-1", orderNumber: "WC-1001", status: "processing",
      source: "woocommerce", totalMinor: "150000", currency: "BDT", itemCount: 3,
    });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("Rahim");
    expect(raw).not.toContain("01711111111");
    expect(raw).not.toContain("House 1");
  });

  it("order.created alone (no ingested) still produces the webhook after the defer window", async () => {
    const { svc, tables, events } = build();
    await seedOrder(tables);
    await svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.created"],
    });
    events.emit("order.created", { organizationId: "org-1", context: { orderId: "order-1" } });
    await sleep(120);
    expect(tables.webhookDelivery.rows).toHaveLength(1);
  });

  it("status_changed / paid / returned map to their public events with their extra fields", async () => {
    const { svc, tables, events } = build();
    await seedOrder(tables);
    await svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x",
      events: ["order.status_changed", "order.paid", "order.returned"],
    });
    events.emit("order.status_changed", { organizationId: "org-1", context: { orderId: "order-1", from: "pending", to: "processing" } });
    events.emit("order.paid", { organizationId: "org-1", context: { orderId: "order-1", transactionId: "txn-9", provider: "bkash", amountMinor: "150000" } });
    events.emit("order.returned", { organizationId: "org-1", context: { orderId: "order-1", returnRequestId: "rr-1", status: "requested" } });
    await sleep(80);
    const byEvent = new Map<string, any>(tables.webhookDelivery.rows.map((d: any) => [d.event, d.payload]));
    expect(byEvent.get("order.status_changed").data).toMatchObject({ from: "pending", to: "processing" });
    expect(byEvent.get("order.paid").data).toMatchObject({ transactionId: "txn-9", provider: "bkash", amountMinor: "150000" });
    expect(byEvent.get("order.returned").data).toEqual({ orderId: "order-1", returnRequestId: "rr-1", status: "requested" });
  });

  it("inactive subscriptions and non-matching events get no delivery; other orgs are untouched", async () => {
    const { svc, tables, events } = build();
    await seedOrder(tables);
    const sub: any = await svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.paid"],
    });
    await svc.updateSubscription("org-1", "u", sub.id, { active: false });
    events.emit("order.status_changed", { organizationId: "org-1", context: { orderId: "order-1", from: "a", to: "b" } });
    events.emit("order.paid", { organizationId: "org-2", context: { orderId: "order-1", transactionId: "t" } });
    await sleep(60);
    expect(tables.webhookDelivery.rows).toHaveLength(0);
  });
});

describe("GB9 webhooks — delivery engine", () => {
  async function setupDelivery(svc: any, tables: any) {
    const created: any = await svc.createSubscription("org-1", "u", {
      url: "https://hooks.example.com/x", events: ["order.created"],
    });
    const delivery = await tables.webhookDelivery.create({
      data: {
        subscriptionId: created.id, organizationId: "org-1", event: "order.created",
        payload: { event: "order.created", organizationId: "org-1", occurredAt: new Date().toISOString(), data: { orderId: "order-1" } },
        status: "pending", nextRetryAt: new Date(Date.now() - 1000),
      },
    });
    return { created, delivery };
  }

  it("2xx marks delivered and signs the raw body with the subscription secret", async () => {
    const { svc, tables } = build();
    const { created, delivery } = await setupDelivery(svc, tables);
    let seen: any = null;
    svc.fetchFn = async (url: string, init: any) => { seen = { url, init }; return { status: 200 }; };
    const outcome = await svc.attemptDelivery(delivery);
    expect(outcome).toBe("delivered");
    const row = tables.webhookDelivery.rows[0];
    expect(row.status).toBe("delivered");
    expect(row.deliveredAt).toBeTruthy();
    expect(row.responseCode).toBe(200);
    expect(seen.init.headers["X-Qosprey-Event"]).toBe("order.created");
    expect(seen.init.headers["X-Qosprey-Delivery"]).toBe(delivery.id);
    const expected = createHmac("sha256", created.secret).update(seen.init.body).digest("hex");
    expect(seen.init.headers["X-Qosprey-Signature"]).toBe(`sha256=${expected}`);
  });

  it("failures schedule 1m → 5m → 30m → 2h and cap at failed on the 5th attempt", async () => {
    const { svc, tables } = build();
    const { delivery } = await setupDelivery(svc, tables);
    svc.fetchFn = async () => ({ status: 500 });
    const expectedDelays = [60_000, 300_000, 1_800_000, 7_200_000];
    let current = delivery;
    for (let i = 0; i < 4; i++) {
      const before = Date.now();
      const outcome = await svc.attemptDelivery(current);
      expect(outcome).toBe("retry");
      current = tables.webhookDelivery.rows[0];
      expect(current.attempts).toBe(i + 1);
      expect(current.status).toBe("pending");
      expect(current.responseCode).toBe(500);
      const delay = new Date(current.nextRetryAt).getTime() - before;
      expect(delay).toBeGreaterThanOrEqual(expectedDelays[i] - 1000);
      expect(delay).toBeLessThan(expectedDelays[i] + 5000);
    }
    const outcome = await svc.attemptDelivery(current);
    expect(outcome).toBe("failed");
    const row = tables.webhookDelivery.rows[0];
    expect(row.attempts).toBe(5);
    expect(row.status).toBe("failed");
    expect(row.nextRetryAt).toBeNull();
  });

  it("network errors are recorded and retried, never thrown", async () => {
    const { svc, tables } = build();
    const { delivery } = await setupDelivery(svc, tables);
    svc.fetchFn = async () => { throw new Error("ECONNREFUSED"); };
    await expect(svc.attemptDelivery(delivery)).resolves.toBe("retry");
    expect(tables.webhookDelivery.rows[0].error).toContain("ECONNREFUSED");
  });

  it("the sweep only attempts due deliveries", async () => {
    const { svc, tables } = build();
    const { created } = await setupDelivery(svc, tables);
    await tables.webhookDelivery.create({
      data: {
        subscriptionId: created.id, organizationId: "org-1", event: "order.created",
        payload: { event: "order.created" }, status: "pending",
        nextRetryAt: new Date(Date.now() + 3600_000),
      },
    });
    let calls = 0;
    svc.fetchFn = async () => { calls++; return { status: 200 }; };
    const result = await svc.runDeliverySweep("org-1");
    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(1);
    expect(calls).toBe(1);
  });

  it("resend reuses the same delivery row (attempts kept) and attempts immediately", async () => {
    const { svc, tables } = build();
    const { delivery } = await setupDelivery(svc, tables);
    svc.fetchFn = async () => ({ status: 500 });
    for (let i = 0; i < 5; i++) await svc.attemptDelivery(tables.webhookDelivery.rows[0]);
    expect(tables.webhookDelivery.rows[0].status).toBe("failed");
    expect(tables.webhookDelivery.rows[0].attempts).toBe(5);
    svc.fetchFn = async () => ({ status: 200 });
    const after: any = await svc.resendDelivery("org-1", delivery.id);
    expect(tables.webhookDelivery.rows).toHaveLength(1);
    expect(after.id).toBe(delivery.id);
    expect(after.status).toBe("delivered");
    expect(after.attempts).toBe(6); // kept, not reset
    await expect(svc.resendDelivery("org-2", delivery.id)).rejects.toMatchObject({ status: 404 });
  });
});
