/**
 * MX12 — the web-push send port WebPushService registers with
 * MessagingService (sendForMessaging). Same harness style as
 * ab7-webpush.spec.ts: real service, in-memory tables, the
 * `web-push` module mocked — no real push is ever sent.
 * Pinned here (the PORT IMPLEMENTATION's side of the contract;
 * the Messaging side is pinned in mx12-push-channel.spec.ts):
 *  - registration: onModuleInit registers a port whose sendPush
 *    delegates to sendForMessaging;
 *  - a successful send returns outcome "sent" with the push
 *    service's real statusCode, and the payload handed to
 *    web-push is exactly { title, body, url } — the shape the
 *    shop service worker renders;
 *  - NO WebPushCampaign / WebPushDelivery rows are created —
 *    the Messaging broadcast's own MessageDelivery rows are
 *    the record;
 *  - 410 → outcome "gone" AND the subscription row is marked
 *    gone here (so future Messaging resolves skip it);
 *  - other failures → outcome "failed" with the real error,
 *    subscription stays active;
 *  - push disabled / subscription missing or not active /
 *    external URL → honest "failed" outcomes, never a throw.
 */
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

jest.mock("web-push", () => ({
  generateVAPIDKeys: jest.fn(() => ({ publicKey: "pub-key-1", privateKey: "priv-key-1" })),
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async () => ({ statusCode: 201 })),
}));

import * as webpush from "web-push";
import { WebPushService } from "./webpush.service";

const wp = webpush as any;

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (row[k] !== v) return false;
  }
  return true;
}

function makeTable(name: string) {
  const table: any = {
    rows: [] as any[],
    findFirst: async ({ where }: any = {}) => table.rows.find((r: any) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => table.rows.filter((r: any) => matchWhere(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: `${name}-${table.rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      table.rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = table.rows.find((r: any) => matchWhere(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    count: async ({ where }: any = {}) => table.rows.filter((r: any) => matchWhere(r, where ?? {})).length,
  };
  return table;
}

const auditStub: any = { log: jest.fn(async () => {}) };

async function enabledService(messaging?: any) {
  const prisma: any = {
    organization: makeTable("org"),
    shopPushSetting: makeTable("setting"),
    webPushSubscription: makeTable("sub"),
    webPushCampaign: makeTable("campaign"),
    webPushDelivery: makeTable("delivery"),
    customer: makeTable("customer"),
  };
  prisma.organization.rows.push({ id: "org-1", slug: "shop-1", name: "Test Shop" });
  const svc = new WebPushService(prisma, auditStub, messaging);
  await svc.updateSetting("org-1", "u-1", { enabled: true });
  prisma.webPushSubscription.rows.push({
    id: "sub-1", organizationId: "org-1", endpoint: "https://push.example.com/1",
    p256dh: "k1", auth: "a1", customerId: "c1", status: "active",
    createdAt: new Date(), lastSeenAt: new Date(),
  });
  return { prisma, svc };
}

beforeEach(() => {
  jest.clearAllMocks();
  wp.generateVAPIDKeys.mockImplementation(() => ({ publicKey: "pub-key-1", privateKey: "priv-key-1" }));
  wp.sendNotification.mockImplementation(async () => ({ statusCode: 201 }));
});

describe("MX12 push-send port", () => {
  it("onModuleInit registers a port on the messaging service; the port delegates to the real send", async () => {
    let registered: any = null;
    const messaging: any = { registerPushSendPort: (port: any) => { registered = port; } };
    const { svc } = await enabledService(messaging);
    svc.onModuleInit();
    expect(registered).not.toBeNull();
    const out = await registered.sendPush("org-1", { subscriptionId: "sub-1", title: "T", body: "B", url: "/sale" });
    expect(out).toEqual({ outcome: "sent", statusCode: 201 });
  });

  it("sent: payload is exactly {title, body, url} and NO campaign/delivery rows are created", async () => {
    const { prisma, svc } = await enabledService();
    const out = await svc.sendForMessaging("org-1", { subscriptionId: "sub-1", title: "ঈদ অফার", body: "আজই দেখুন", url: "/sale" });
    expect(out.outcome).toBe("sent");
    expect(out.statusCode).toBe(201);
    const payload = JSON.parse(wp.sendNotification.mock.calls[0][1]);
    expect(payload).toEqual({ title: "ঈদ অফার", body: "আজই দেখুন", url: "/sale" });
    expect(prisma.webPushCampaign.rows).toHaveLength(0);
    expect(prisma.webPushDelivery.rows).toHaveLength(0);
    expect(prisma.webPushSubscription.rows[0].status).toBe("active");
  });

  it("410: outcome gone AND the subscription row is marked gone", async () => {
    const err: any = new Error("subscription has unsubscribed or expired");
    err.statusCode = 410;
    wp.sendNotification.mockImplementation(async () => { throw err; });
    const { prisma, svc } = await enabledService();
    const out = await svc.sendForMessaging("org-1", { subscriptionId: "sub-1", title: "T", body: "B" });
    expect(out.outcome).toBe("gone");
    expect(out.statusCode).toBe(410);
    expect(out.error).toContain("unsubscribed or expired");
    expect(prisma.webPushSubscription.rows[0].status).toBe("gone");
  });

  it("500: outcome failed with the real error; the subscription stays active", async () => {
    const err: any = new Error("push service unavailable");
    err.statusCode = 500;
    wp.sendNotification.mockImplementation(async () => { throw err; });
    const { prisma, svc } = await enabledService();
    const out = await svc.sendForMessaging("org-1", { subscriptionId: "sub-1", title: "T", body: "B" });
    expect(out).toEqual({ outcome: "failed", statusCode: 500, error: "push service unavailable" });
    expect(prisma.webPushSubscription.rows[0].status).toBe("active");
  });

  it("honest failures: push disabled, missing subscription, gone subscription, external URL", async () => {
    const { prisma, svc } = await enabledService();
    prisma.shopPushSetting.rows[0].enabled = false;
    await expect(svc.sendForMessaging("org-1", { subscriptionId: "sub-1", title: "T", body: "B" }))
      .resolves.toMatchObject({ outcome: "failed" });
    prisma.shopPushSetting.rows[0].enabled = true;
    await expect(svc.sendForMessaging("org-1", { subscriptionId: "nope", title: "T", body: "B" }))
      .resolves.toMatchObject({ outcome: "failed", error: expect.stringContaining("not found") });
    prisma.webPushSubscription.rows[0].status = "gone";
    await expect(svc.sendForMessaging("org-1", { subscriptionId: "sub-1", title: "T", body: "B" }))
      .resolves.toMatchObject({ outcome: "failed", error: expect.stringContaining("gone") });
    prisma.webPushSubscription.rows[0].status = "active";
    await expect(svc.sendForMessaging("org-1", { subscriptionId: "sub-1", title: "T", body: "B", url: "https://evil.example.com" }))
      .resolves.toMatchObject({ outcome: "failed", error: expect.stringContaining("shop-relative") });
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });
});
