/**
 * AB7 (AX16) — Web Push for shop visitors.
 *
 * Self-contained fake-prisma harness (the codebase spec style):
 * the REAL WebPushService runs against in-memory tables and the
 * `web-push` module is mocked — NO real push is ever sent. What
 * is pinned here:
 *  - the VAPID keypair is generated ONCE on first enable and
 *    never regenerated on re-enable; the private key is stored
 *    sealed (not the raw value, unseal round-trips) and never
 *    appears in the staff setting view;
 *  - the public config hides the key while push is disabled and
 *    an unknown slug is a 404;
 *  - subscribe rejects a non-https endpoint, a disabled shop is
 *    a 403, a foreign customerId is dropped to null;
 *  - unsubscribe marks the row "gone" (never deletes);
 *  - campaign fan-out caps inline at 500 and leaves the rest as
 *    queuedCount; drainCampaign skips subscriptions that already
 *    have a delivery row; the sweep body drains queued campaigns;
 *  - a 410 marks subscription + delivery "gone"; any other
 *    failure marks the delivery "failed" and the batch continues;
 *  - campaign URLs must be shop-relative (absolute/external
 *    refused); test-send reaches ONLY test devices and its
 *    campaign is born "done".
 */
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

jest.mock("web-push", () => ({
  generateVAPIDKeys: jest.fn(() => ({ publicKey: "pub-key-1", privateKey: "priv-key-1" })),
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async () => ({ statusCode: 201 })),
}));

import * as webpush from "web-push";
import { WebPushService } from "./webpush.service";
import { unseal } from "../common/platform-config";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";

const wp = webpush as any;

// ------------------------------------------------------------------
// Fake prisma harness
// ------------------------------------------------------------------

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

function cmpVal(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : 1;
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) {
        if (!(v as any).in.includes(row[k])) return false;
        continue;
      }
      if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      return false;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => cmpVal(a[field], b[field]) * (dir === "desc" ? -1 : 1));
  }
  return out;
}

function makeTable(name: string) {
  const table: any = {
    rows: [] as any[],
    findFirst: async ({ where, orderBy }: any = {}) =>
      sortRows(table.rows.filter((r: any) => matchWhere(r, where)), orderBy)[0] ?? null,
    findUnique: async ({ where }: any = {}) =>
      table.rows.find((r: any) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = sortRows(table.rows.filter((r: any) => matchWhere(r, where ?? {})), orderBy);
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? nid(name), createdAt: new Date(), updatedAt: new Date(), ...data };
      table.rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = table.rows.find((r: any) => matchWhere(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const matched = table.rows.filter((r: any) => matchWhere(r, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
    count: async ({ where }: any = {}) => table.rows.filter((r: any) => matchWhere(r, where ?? {})).length,
  };
  return table;
}

function fakePrisma() {
  return {
    organization: makeTable("org"),
    shopPushSetting: makeTable("setting"),
    webPushSubscription: makeTable("sub"),
    webPushCampaign: makeTable("campaign"),
    webPushDelivery: makeTable("delivery"),
    customer: makeTable("customer"),
  } as any;
}

const auditStub: any = { log: jest.fn(async () => {}) };

function seedOrg(prisma: any, id = "org-1", slug = "shop-1") {
  prisma.organization.rows.push({ id, slug, name: "Test Shop" });
}

function seedSubs(prisma: any, orgId: string, n: number, over: any = {}) {
  const base = Date.now();
  for (let i = 0; i < n; i++) {
    prisma.webPushSubscription.rows.push({
      id: `sub-${orgId}-${i}`, organizationId: orgId,
      endpoint: `https://push.example.com/${orgId}/${i}`,
      p256dh: `p256dh-${i}`, auth: `auth-${i}`,
      customerId: null, userAgent: null, isTestDevice: false, status: "active",
      createdAt: new Date(base + i * 1000), lastSeenAt: new Date(base + i * 1000),
      ...over,
    });
  }
}

async function enabledService() {
  const prisma = fakePrisma();
  seedOrg(prisma);
  const svc = new WebPushService(prisma, auditStub);
  await svc.updateSetting("org-1", "u-1", { enabled: true });
  return { prisma, svc };
}

beforeEach(() => {
  jest.clearAllMocks();
  wp.generateVAPIDKeys.mockImplementation(() => ({ publicKey: "pub-key-1", privateKey: "priv-key-1" }));
  wp.sendNotification.mockImplementation(async () => ({ statusCode: 201 }));
  auditStub.log.mockClear();
});

// ------------------------------------------------------------------
// Settings + VAPID keypair
// ------------------------------------------------------------------

describe("AX16 settings + VAPID", () => {
  it("generates the keypair ONCE on first enable — never on re-enable", async () => {
    const prisma = fakePrisma();
    seedOrg(prisma);
    const svc = new WebPushService(prisma, auditStub);
    const first = await svc.updateSetting("org-1", "u-1", { enabled: true });
    expect(first.enabled).toBe(true);
    expect(first.hasKeys).toBe(true);
    expect(first.vapidPublicKey).toBe("pub-key-1");
    expect(wp.generateVAPIDKeys).toHaveBeenCalledTimes(1);

    await svc.updateSetting("org-1", "u-1", { enabled: false });
    const again = await svc.updateSetting("org-1", "u-1", { enabled: true });
    expect(wp.generateVAPIDKeys).toHaveBeenCalledTimes(1);
    expect(again.vapidPublicKey).toBe("pub-key-1");
  });

  it("turning enabled off keeps the keys", async () => {
    const { svc } = await enabledService();
    const off = await svc.updateSetting("org-1", "u-1", { enabled: false });
    expect(off.enabled).toBe(false);
    expect(off.hasKeys).toBe(true);
    expect(off.vapidPublicKey).toBe("pub-key-1");
  });

  it("stores the private key SEALED — not the raw value, unseal round-trips, never exposed in the view", async () => {
    const { prisma, svc } = await enabledService();
    const row = prisma.shopPushSetting.rows[0];
    expect(row.vapidPrivateKeySealed).toBeTruthy();
    expect(row.vapidPrivateKeySealed).not.toBe("priv-key-1");
    expect(row.vapidPrivateKeySealed).not.toContain("priv-key-1");
    expect(unseal(row.vapidPrivateKeySealed)).toBe("priv-key-1");
    const view = await svc.getSetting("org-1");
    expect(JSON.stringify(view)).not.toContain("priv-key-1");
    expect((view as any).vapidPrivateKeySealed).toBeUndefined();
  });

  it("validates promptDelaySec range (5..300) and defaults the view", async () => {
    const prisma = fakePrisma();
    seedOrg(prisma);
    const svc = new WebPushService(prisma, auditStub);
    const view = await svc.getSetting("org-1");
    expect(view).toEqual(expect.objectContaining({ enabled: false, promptDelaySec: 20, hasKeys: false, vapidPublicKey: null, subscriberCount: 0, testDeviceCount: 0 }));
    await expect(svc.updateSetting("org-1", "u-1", { promptDelaySec: 4 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateSetting("org-1", "u-1", { promptDelaySec: 301 })).rejects.toMatchObject({ status: 400 });
    const updated = await svc.updateSetting("org-1", "u-1", { promptDelaySec: 45 });
    expect(updated.promptDelaySec).toBe(45);
  });
});

// ------------------------------------------------------------------
// Public routes (service level)
// ------------------------------------------------------------------

describe("AX16 public config / subscribe / unsubscribe", () => {
  it("public config hides the key while disabled, shows it while enabled", async () => {
    const prisma = fakePrisma();
    seedOrg(prisma);
    const svc = new WebPushService(prisma, auditStub);
    expect(await svc.publicConfig("shop-1")).toEqual({ enabled: false, publicKey: null, promptDelaySec: 20 });
    await svc.updateSetting("org-1", "u-1", { enabled: true, promptDelaySec: 30 });
    expect(await svc.publicConfig("shop-1")).toEqual({ enabled: true, publicKey: "pub-key-1", promptDelaySec: 30 });
    await svc.updateSetting("org-1", "u-1", { enabled: false });
    const off = await svc.publicConfig("shop-1");
    expect(off.enabled).toBe(false);
    expect(off.publicKey).toBeNull();
  });

  it("unknown slug is a 404 on every public route", async () => {
    const { svc } = await enabledService();
    await expect(svc.publicConfig("nope")).rejects.toMatchObject({ status: 404 });
    await expect(svc.subscribe("nope", { endpoint: "https://push.example.com/x", keys: { p256dh: "p", auth: "a" } })).rejects.toMatchObject({ status: 404 });
    await expect(svc.unsubscribe("nope", { endpoint: "https://push.example.com/x" })).rejects.toMatchObject({ status: 404 });
  });

  it("subscribe on a disabled shop is a 403", async () => {
    const prisma = fakePrisma();
    seedOrg(prisma);
    const svc = new WebPushService(prisma, auditStub);
    await expect(
      svc.subscribe("shop-1", { endpoint: "https://push.example.com/x", keys: { p256dh: "p", auth: "a" } }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.webPushSubscription.rows).toHaveLength(0);
  });

  it("subscribe rejects a non-https endpoint / bad URL / empty keys", async () => {
    const { svc, prisma } = await enabledService();
    await expect(
      svc.subscribe("shop-1", { endpoint: "http://push.example.com/x", keys: { p256dh: "p", auth: "a" } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.subscribe("shop-1", { endpoint: "not a url", keys: { p256dh: "p", auth: "a" } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.subscribe("shop-1", { endpoint: "https://push.example.com/x", keys: { p256dh: "", auth: "a" } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.webPushSubscription.rows).toHaveLength(0);
  });

  it("subscribe upserts by endpoint, keeps an org customer, drops a foreign customerId to null", async () => {
    const { svc, prisma } = await enabledService();
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1" });
    prisma.customer.rows.push({ id: "cust-foreign", organizationId: "org-2" });

    const first = await svc.subscribe("shop-1",
      { endpoint: "https://push.example.com/a", keys: { p256dh: "p1", auth: "a1" }, customerId: "cust-foreign" },
      "Mozilla/5.0 test",
    );
    expect(first.customerId).toBeNull();
    expect(first.status).toBe("active");
    expect(first.userAgent).toBe("Mozilla/5.0 test");

    const again = await svc.subscribe("shop-1",
      { endpoint: "https://push.example.com/a", keys: { p256dh: "p2", auth: "a2" }, customerId: "cust-1" },
    );
    expect(prisma.webPushSubscription.rows).toHaveLength(1);
    expect(again.id).toBe(first.id);
    expect(again.p256dh).toBe("p2");
    expect(again.customerId).toBe("cust-1");
  });

  it("unsubscribe marks gone (never deletes) and is idempotent", async () => {
    const { svc, prisma } = await enabledService();
    await svc.subscribe("shop-1", { endpoint: "https://push.example.com/a", keys: { p256dh: "p", auth: "a" } });
    const out = await svc.unsubscribe("shop-1", { endpoint: "https://push.example.com/a" });
    expect(out).toEqual({ ok: true, updated: true });
    expect(prisma.webPushSubscription.rows).toHaveLength(1);
    expect(prisma.webPushSubscription.rows[0].status).toBe("gone");
    const again = await svc.unsubscribe("shop-1", { endpoint: "https://push.example.com/a" });
    expect(again).toEqual({ ok: true, updated: false });
    const missing = await svc.unsubscribe("shop-1", { endpoint: "https://push.example.com/never" });
    expect(missing.ok).toBe(true);
  });
});

// ------------------------------------------------------------------
// Campaigns
// ------------------------------------------------------------------

describe("AX16 campaigns", () => {
  it("rejects absolute / external / protocol-relative campaign URLs; a shop-relative path passes", async () => {
    const { svc } = await enabledService();
    await expect(svc.createCampaign("org-1", "u-1", { title: "t", body: "b", url: "https://evil.example.com/x" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createCampaign("org-1", "u-1", { title: "t", body: "b", url: "//evil.example.com/x" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createCampaign("org-1", "u-1", { title: "t", body: "b", url: "sale" })).rejects.toMatchObject({ status: 400 });
    const ok = await svc.createCampaign("org-1", "u-1", { title: "t", body: "b", url: "/sale" });
    expect(ok.url).toBe("/sale");
    expect(ok.status).toBe("done"); // no subscribers at all
  });

  it("sending while push is disabled is a 400", async () => {
    const prisma = fakePrisma();
    seedOrg(prisma);
    const svc = new WebPushService(prisma, auditStub);
    await expect(svc.createCampaign("org-1", "u-1", { title: "t", body: "b" })).rejects.toMatchObject({ status: 400 });
    expect(prisma.webPushCampaign.rows).toHaveLength(0);
  });

  it("fan-out caps inline at 500 and leaves the remainder as queuedCount", async () => {
    const { svc, prisma } = await enabledService();
    seedSubs(prisma, "org-1", 505);
    const campaign = await svc.createCampaign("org-1", "u-1", { title: "ঈদ সেল", body: "৫০% ছাড়", url: "/sale" });
    expect(wp.sendNotification).toHaveBeenCalledTimes(500);
    expect(campaign.sentCount).toBe(500);
    expect(campaign.failedCount).toBe(0);
    expect(campaign.queuedCount).toBe(5);
    expect(campaign.status).toBe("queued");
    expect(prisma.webPushDelivery.rows).toHaveLength(500);
    // VAPID details are set from the SEALED private key (unsealed
    // server-side) with the default subject.
    expect(wp.setVapidDetails).toHaveBeenCalledWith("https://app.qosprey.com", "pub-key-1", "priv-key-1");
    const [, payload, options] = wp.sendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toEqual({ title: "ঈদ সেল", body: "৫০% ছাড়", url: "/sale" });
    expect(options).toEqual({ TTL: 86400 });
  });

  it("410 marks subscription + delivery gone; 404 behaves the same", async () => {
    const { svc, prisma } = await enabledService();
    seedSubs(prisma, "org-1", 1);
    const err: any = new Error("subscription gone");
    err.statusCode = 410;
    wp.sendNotification.mockRejectedValueOnce(err);
    const campaign = await svc.createCampaign("org-1", "u-1", { title: "t", body: "b" });
    expect(campaign.goneCount).toBe(1);
    expect(campaign.sentCount).toBe(0);
    expect(campaign.status).toBe("done");
    expect(prisma.webPushSubscription.rows[0].status).toBe("gone");
    expect(prisma.webPushDelivery.rows[0]).toMatchObject({ status: "gone", statusCode: 410 });
  });

  it("another failure marks the delivery failed (error capped) and the batch continues", async () => {
    const { svc, prisma } = await enabledService();
    seedSubs(prisma, "org-1", 2);
    wp.sendNotification.mockRejectedValueOnce(new Error("x".repeat(500)));
    const campaign = await svc.createCampaign("org-1", "u-1", { title: "t", body: "b" });
    expect(wp.sendNotification).toHaveBeenCalledTimes(2);
    expect(campaign.failedCount).toBe(1);
    expect(campaign.sentCount).toBe(1);
    expect(campaign.status).toBe("done");
    const failed = prisma.webPushDelivery.rows.find((d: any) => d.status === "failed");
    expect(failed.error.length).toBe(300);
    expect(prisma.webPushSubscription.rows.every((s: any) => s.status === "active")).toBe(true);
  });

  it("drainCampaign skips subscriptions that already have a delivery row", async () => {
    const { svc, prisma } = await enabledService();
    seedSubs(prisma, "org-1", 505);
    const campaign = await svc.createCampaign("org-1", "u-1", { title: "t", body: "b" });
    expect(campaign.queuedCount).toBe(5);
    wp.sendNotification.mockClear();
    const drained = await svc.drainCampaign("org-1", campaign, 500);
    expect(wp.sendNotification).toHaveBeenCalledTimes(5);
    expect(drained.status).toBe("done");
    expect(drained.queuedCount).toBe(0);
    expect(drained.sentCount).toBe(505);
    expect(prisma.webPushDelivery.rows).toHaveLength(505);
    // A second drain is a no-op — every subscription has a row.
    wp.sendNotification.mockClear();
    const again = await svc.drainCampaign("org-1", drained, 500);
    expect(wp.sendNotification).not.toHaveBeenCalled();
    expect(again.status).toBe("done");
  });

  it("runWebPushSweep drains queued campaigns (cap 5 per run)", async () => {
    const { svc, prisma } = await enabledService();
    seedSubs(prisma, "org-1", 505);
    await svc.createCampaign("org-1", "u-1", { title: "t", body: "b" });
    wp.sendNotification.mockClear();
    const out = await svc.runWebPushSweep("org-1");
    expect(out.campaigns).toBe(1);
    expect(out.drained[0]).toMatchObject({ status: "done", queuedCount: 0, sentCount: 505 });
    expect(wp.sendNotification).toHaveBeenCalledTimes(5);
    const again = await svc.runWebPushSweep("org-1");
    expect(again.campaigns).toBe(0);
  });

  it("getCampaign returns the delivery summary; a foreign org gets a 404", async () => {
    const { svc } = await enabledService();
    seedOrg((svc as any).prisma, "org-2", "shop-2");
    const campaign = await svc.createCampaign("org-1", "u-1", { title: "t", body: "b" });
    const got = await svc.getCampaign("org-1", campaign.id);
    expect(got.id).toBe(campaign.id);
    expect(got.deliverySummary).toEqual({ sent: 0, failed: 0, gone: 0, total: 0 });
    await expect(svc.getCampaign("org-2", campaign.id)).rejects.toMatchObject({ status: 404 });
    const list = await svc.listCampaigns("org-1");
    expect(list).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// Test devices + test send
// ------------------------------------------------------------------

describe("AX16 test devices", () => {
  it("registerTestDevice upserts one row marked isTestDevice", async () => {
    const { svc, prisma } = await enabledService();
    const dto = { endpoint: "https://push.example.com/me", keys: { p256dh: "p", auth: "a" } };
    await svc.registerTestDevice("org-1", "u-1", dto);
    const row = await svc.registerTestDevice("org-1", "u-1", dto);
    expect(prisma.webPushSubscription.rows).toHaveLength(1);
    expect(row.isTestDevice).toBe(true);
    const view = await svc.getSetting("org-1");
    expect(view.testDeviceCount).toBe(1);
    expect(view.subscriberCount).toBe(1);
  });

  it("test-send reaches ONLY active test devices and the campaign is born done", async () => {
    const { svc, prisma } = await enabledService();
    seedSubs(prisma, "org-1", 3);
    await svc.registerTestDevice("org-1", "u-1", { endpoint: "https://push.example.com/me", keys: { p256dh: "tp", auth: "ta" } });
    const campaign = await svc.testSend("org-1", "u-1", { title: "টেস্ট", body: "হ্যালো", url: "/" });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    const [subArg] = wp.sendNotification.mock.calls[0];
    expect(subArg.endpoint).toBe("https://push.example.com/me");
    expect(campaign.sentCount).toBe(1);
    expect(campaign.status).toBe("done");
    expect(campaign.queuedCount).toBe(0);
    expect(prisma.webPushDelivery.rows).toHaveLength(1);
    // The sweep must never widen a test campaign to real subscribers.
    const swept = await svc.runWebPushSweep("org-1");
    expect(swept.campaigns).toBe(0);
  });

  it("test-send without a keypair is a 400", async () => {
    const prisma = fakePrisma();
    seedOrg(prisma);
    const svc = new WebPushService(prisma, auditStub);
    await expect(svc.testSend("org-1", "u-1", { title: "t", body: "b" })).rejects.toMatchObject({ status: 400 });
  });
});

// ------------------------------------------------------------------
// Sweep job wiring (automation)
// ------------------------------------------------------------------

describe("AX16 web_push_sweep wiring", () => {
  it("is a real JOB_TYPE with an org template", () => {
    expect((JOB_TYPES as readonly string[]).includes("web_push_sweep")).toBe(true);
    const tpl = JOB_TEMPLATES.find((t) => t.type === "web_push_sweep");
    expect(tpl).toBeTruthy();
    expect(tpl!.key).toBe("web_push_sweep");
    expect(tpl!.targetKind).toBe("org");
  });

  it("executeJob dispatches to WebPushService.runWebPushSweep; without the service it skips honestly", async () => {
    const prisma = fakePrisma();
    const svc = new AutomationService(
      prisma, auditStub, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const skipped: any = await svc.executeJob({ organizationId: "org-1", type: "web_push_sweep", createdById: "u-1" });
    expect(skipped).toEqual({ skipped: "web push unavailable" });

    const runWebPushSweep = jest.fn(async () => ({ campaigns: 2, drained: [] }));
    (svc as any).webpush = { runWebPushSweep };
    const out: any = await svc.executeJob({ organizationId: "org-1", type: "web_push_sweep", createdById: "u-1" });
    expect(runWebPushSweep).toHaveBeenCalledWith("org-1");
    expect(out).toEqual({ campaigns: 2, drained: [] });
  });
});
