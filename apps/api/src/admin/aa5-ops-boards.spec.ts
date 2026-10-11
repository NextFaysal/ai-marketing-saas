process.env.ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { computeAdAccountHealth, AD_HEALTH_STALE_MS } from "../ads/ad-health";

/**
 * Admin Advanced AA5 — Social + Ads Operator Boards.
 *
 * Covers:
 *  (a) healthIntegrations broken entries carry lastError +
 *      lastSyncAt (audit finding D5 regression)
 *  (b) socialBoard counts by status/platform; the error list
 *      carries lastError verbatim and caps at 100
 *  (c) posts attention: sent_to_creator stale at 48h, stuck
 *      publishing at 15min (SP5 definition), failed caption
 *      excerpt truncated at 80 chars
 *  (d) adsBoard: health bands via the shared pure function,
 *      platform buckets (null → "none"), broken list with
 *      displayName = label ?? name and the integration's
 *      verbatim lastError
 *  (e) recursive key scan over both board payloads + the
 *      health payload: no credential-shaped key anywhere
 */

const audit = { log: async () => undefined } as any;

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("lt" in v) return new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function applySelect(row: any, select: any) {
  if (!select) return { ...row };
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}
function table(rows: any[] = []) {
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => matches(r, args.where));
      if (args.orderBy?.updatedAt === "desc") out = [...out].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      if (args.orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (args.orderBy?.createdAt === "asc") out = [...out].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      if (args.take != null) out = out.slice(0, args.take);
      return out.map((r) => applySelect(r, args.select));
    },
    count: async (args: any = {}) => rows.filter((r) => matches(r, args.where)).length,
    findFirst: async (args: any = {}) => rows.find((r) => matches(r, args.where)) ?? null,
    findUnique: async (args: any = {}) => rows.find((r) => r.id === args.where?.id) ?? null,
  };
}
function makePrisma(seed: {
  orgs?: any[]; integrations?: any[]; socialAccounts?: any[]; socialPosts?: any[]; adAccounts?: any[];
} = {}) {
  return {
    organization: table(seed.orgs ?? []),
    integration: table(seed.integrations ?? []),
    socialAccount: table(seed.socialAccounts ?? []),
    socialPost: table(seed.socialPosts ?? []),
    adAccount: table(seed.adAccounts ?? []),
  } as any;
}
function svc(prisma: any) { return new AdminService(prisma, audit); }

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);
const minsAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
const ORGS = [
  { id: "org-1", name: "Demo Store" },
  { id: "org-2", name: "Second Shop" },
];

function collectKeys(value: any, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) collectKeys(v, into); return into; }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) { into.add(k); collectKeys(v, into); }
  }
  return into;
}

describe("AA5 — ad-health pure function (shared by tenant list + board)", () => {
  it("exposes the 48h stale threshold and derives every band", () => {
    const now = Date.now();
    expect(AD_HEALTH_STALE_MS).toBe(48 * 3600 * 1000);
    expect(computeAdAccountHealth({ sourceType: "api", syncDisabled: true, integrationId: "i1" }, { status: "CONNECTED", lastSyncAt: hoursAgo(100) }, now)).toBe("sync_disabled");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: null }, null, now)).toBe("disconnected");
    expect(computeAdAccountHealth({ sourceType: "manual", integrationId: null }, null, now)).toBe("manual");
    expect(computeAdAccountHealth({ sourceType: "csv", integrationId: null }, null, now)).toBe("manual");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "gone" }, null, now)).toBe("disconnected");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "ERROR", lastSyncAt: hoursAgo(1) }, now)).toBe("error");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "DISCONNECTED", lastSyncAt: hoursAgo(1) }, now)).toBe("disconnected");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "CONNECTED", lastSyncAt: hoursAgo(1) }, now)).toBe("connected");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "CONNECTED", lastSyncAt: hoursAgo(72) }, now)).toBe("stale");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "CONNECTED", lastSyncAt: null }, now)).toBe("stale");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "CONNECTED", lastSyncAt: "not-a-date" }, now)).toBe("stale");
    expect(computeAdAccountHealth({ sourceType: "api", integrationId: "i1" }, { status: "SOMETHING_ELSE", lastSyncAt: hoursAgo(1) }, now)).toBe("disconnected");
  });
});

describe("AA5 (a) — healthIntegrations D5 fix", () => {
  it("broken entries include lastError + lastSyncAt verbatim", async () => {
    const syncAt = hoursAgo(5);
    const prisma = makePrisma({
      orgs: ORGS,
      integrations: [
        { id: "int-ok", provider: "meta", status: "CONNECTED", organizationId: "org-1", lastError: null, lastSyncAt: hoursAgo(1), updatedAt: hoursAgo(1) },
        { id: "int-bad", provider: "meta", status: "ERROR", organizationId: "org-1", lastError: "Token expired — verbatim #42", lastSyncAt: syncAt, updatedAt: hoursAgo(2) },
      ],
    });
    const out: any = await svc(prisma).healthIntegrations();
    expect(out.broken).toHaveLength(1);
    expect(out.broken[0]).toMatchObject({
      id: "int-bad", provider: "meta", status: "ERROR",
      organizationId: "org-1", organizationName: "Demo Store",
      lastError: "Token expired — verbatim #42",
    });
    expect(new Date(out.broken[0].lastSyncAt).getTime()).toBe(syncAt.getTime());
  });
});

describe("AA5 (b) — socialBoard account counts + error list", () => {
  it("counts by status and platform, total, and resolves org names", async () => {
    const prisma = makePrisma({
      orgs: ORGS,
      socialAccounts: [
        { id: "sa-1", organizationId: "org-1", platform: "meta_page", name: "Page One", username: "pageone", status: "connected", lastError: null, updatedAt: hoursAgo(1) },
        { id: "sa-2", organizationId: "org-1", platform: "meta_page", name: "Page Two", username: null, status: "connected", lastError: null, updatedAt: hoursAgo(2) },
        { id: "sa-3", organizationId: "org-2", platform: "instagram", name: "IG One", username: "igone", status: "error", lastError: "IG session invalidated — verbatim!", updatedAt: hoursAgo(3) },
        { id: "sa-4", organizationId: "org-2", platform: "tiktok", name: "TT One", username: "ttone", status: "disconnected", lastError: null, updatedAt: hoursAgo(4) },
      ],
    });
    const out: any = await svc(prisma).socialBoard();
    expect(out.accounts.total).toBe(4);
    expect(out.accounts.byStatus).toEqual({ connected: 2, error: 1, disconnected: 1 });
    expect(out.accounts.byPlatform).toEqual({ meta_page: 2, instagram: 1, tiktok: 1 });
    expect(out.errorAccounts).toHaveLength(1);
    expect(out.errorAccounts[0]).toMatchObject({
      id: "sa-3", organizationId: "org-2", organizationName: "Second Shop",
      platform: "instagram", name: "IG One", username: "igone",
      lastError: "IG session invalidated — verbatim!",
    });
    expect(out.posts.failed).toEqual([]);
    expect(out.posts.sentToCreatorStale).toEqual({ count: 0, items: [] });
    expect(out.posts.stuckPublishing).toEqual({ count: 0, items: [] });
  });

  it("error list caps at 100, newest first, lastError verbatim", async () => {
    const base = Date.now() - 1000 * 1000;
    const accounts = Array.from({ length: 105 }, (_, i) => ({
      id: `sa-err-${i}`, organizationId: "org-1", platform: "meta_page",
      name: `Err Page ${i}`, username: null, status: "error",
      lastError: `verbatim error ${i}`, updatedAt: new Date(base + i * 1000),
    }));
    const prisma = makePrisma({ orgs: ORGS, socialAccounts: accounts });
    const out: any = await svc(prisma).socialBoard();
    expect(out.accounts.total).toBe(105);
    expect(out.accounts.byStatus).toEqual({ error: 105 });
    expect(out.errorAccounts).toHaveLength(100);
    expect(out.errorAccounts[0].id).toBe("sa-err-104");
    expect(out.errorAccounts[0].lastError).toBe("verbatim error 104");
    expect(out.errorAccounts[99].id).toBe("sa-err-5");
  });
});

describe("AA5 (c) — socialBoard posts attention", () => {
  it("48h / 15min cutoffs, failed shape, and the 80-char caption excerpt", async () => {
    const longCaption = "ক".repeat(120);
    const prisma = makePrisma({
      orgs: ORGS,
      socialAccounts: [
        { id: "sa-1", organizationId: "org-1", platform: "tiktok", name: "TT Shop", username: "ttshop", status: "connected", lastError: null, updatedAt: hoursAgo(1) },
      ],
      socialPosts: [
        { id: "p-stale", organizationId: "org-1", socialAccountId: "sa-1", caption: "stale creator post", status: "sent_to_creator", error: null, scheduledAt: null, updatedAt: hoursAgo(49) },
        { id: "p-fresh-creator", organizationId: "org-1", socialAccountId: "sa-1", caption: "fresh creator post", status: "sent_to_creator", error: null, scheduledAt: null, updatedAt: hoursAgo(1) },
        { id: "p-stuck", organizationId: "org-1", socialAccountId: "sa-1", caption: "stuck post", status: "publishing", error: null, scheduledAt: null, updatedAt: minsAgo(16) },
        { id: "p-recent-pub", organizationId: "org-1", socialAccountId: "sa-1", caption: "recent publishing", status: "publishing", error: null, scheduledAt: null, updatedAt: minsAgo(5) },
        { id: "p-failed", organizationId: "org-1", socialAccountId: "sa-1", caption: longCaption, status: "failed", error: "Graph error 190 — verbatim", scheduledAt: hoursAgo(3), updatedAt: hoursAgo(2) },
      ],
    });
    const out: any = await svc(prisma).socialBoard();

    expect(out.posts.sentToCreatorStale.count).toBe(1);
    expect(out.posts.sentToCreatorStale.items.map((i: any) => i.id)).toEqual(["p-stale"]);
    expect(out.posts.stuckPublishing.count).toBe(1);
    expect(out.posts.stuckPublishing.items.map((i: any) => i.id)).toEqual(["p-stuck"]);

    expect(out.posts.failed).toHaveLength(1);
    const failed = out.posts.failed[0];
    expect(failed.id).toBe("p-failed");
    expect(failed.captionExcerpt).toHaveLength(80);
    expect(failed.captionExcerpt).toBe(longCaption.slice(0, 80));
    expect(failed).toMatchObject({
      organizationId: "org-1", organizationName: "Demo Store",
      socialAccountId: "sa-1", accountName: "TT Shop", platform: "tiktok",
      status: "failed", error: "Graph error 190 — verbatim",
    });
    // The attention items share the same resolved shape.
    expect(out.posts.sentToCreatorStale.items[0]).toMatchObject({ accountName: "TT Shop", platform: "tiktok", organizationName: "Demo Store" });
    expect(out.posts.stuckPublishing.items[0]).toMatchObject({ accountName: "TT Shop", platform: "tiktok" });
  });
});

describe("AA5 (d) — adsBoard bands, buckets, broken list", () => {
  it("band counts, platform buckets incl. none, displayName, verbatim lastError", async () => {
    const prisma = makePrisma({
      orgs: ORGS,
      integrations: [
        { id: "int-err", status: "ERROR", lastSyncAt: hoursAgo(1), lastError: "Ad token revoked — VERBATIM", createdAt: hoursAgo(100) },
        { id: "int-stale", status: "CONNECTED", lastSyncAt: hoursAgo(72), lastError: null, createdAt: hoursAgo(100) },
        { id: "int-fresh", status: "CONNECTED", lastSyncAt: hoursAgo(1), lastError: null, createdAt: hoursAgo(100) },
      ],
      adAccounts: [
        { id: "a-err", organizationId: "org-1", integrationId: "int-err", platform: "meta", sourceType: "api", name: "Platform Name", label: "My Label", status: "ACTIVE", platformStatusBucket: null, syncDisabled: false, updatedAt: hoursAgo(1) },
        { id: "a-stale", organizationId: "org-1", integrationId: "int-stale", platform: "meta", sourceType: "api", name: "Stale Acc", label: null, status: "ACTIVE", platformStatusBucket: "active", syncDisabled: false, updatedAt: hoursAgo(2) },
        { id: "a-disabled", organizationId: "org-2", integrationId: "int-fresh", platform: "google", sourceType: "api", name: "Disabled Acc", label: null, status: "ACTIVE", platformStatusBucket: "disabled", syncDisabled: false, updatedAt: hoursAgo(3) },
        { id: "a-sync-off", organizationId: "org-1", integrationId: "int-fresh", platform: "meta", sourceType: "api", name: "Sync Off Acc", label: null, status: "ACTIVE", platformStatusBucket: null, syncDisabled: true, updatedAt: hoursAgo(4) },
        { id: "a-manual", organizationId: "org-2", integrationId: null, platform: "manual", sourceType: "manual", name: "Manual Acc", label: null, status: "ACTIVE", platformStatusBucket: null, syncDisabled: false, updatedAt: hoursAgo(5) },
      ],
    });
    const out: any = await svc(prisma).adsBoard();
    expect(out.total).toBe(5);
    expect(out.byHealth).toEqual({ error: 1, stale: 1, connected: 1, sync_disabled: 1, manual: 1 });
    expect(out.platformBuckets).toEqual({ none: 3, active: 1, disabled: 1 });
    expect(out.syncDisabledCount).toBe(1);

    // Broken = error band OR disabled/restricted bucket; error first.
    expect(out.broken.map((b: any) => b.id)).toEqual(["a-err", "a-disabled"]);
    expect(out.broken[0]).toMatchObject({
      organizationId: "org-1", organizationName: "Demo Store",
      name: "Platform Name", label: "My Label", displayName: "My Label",
      platform: "meta", health: "error", platformStatusBucket: null,
      lastError: "Ad token revoked — VERBATIM",
    });
    expect(new Date(out.broken[0].lastSyncAt).getTime()).toBe(new Date((prisma.integration.rows[0] as any).lastSyncAt).getTime());
    expect(out.broken[1]).toMatchObject({
      organizationId: "org-2", organizationName: "Second Shop",
      name: "Disabled Acc", label: null, displayName: "Disabled Acc",
      platform: "google", health: "connected", platformStatusBucket: "disabled", lastError: null,
    });
  });
});

describe("AA5 (e) — no credential-shaped key in any operator payload", () => {
  it("key scan over socialBoard + adsBoard + healthIntegrations payloads", async () => {
    const prisma = makePrisma({
      orgs: ORGS,
      integrations: [
        {
          id: "int-err", provider: "meta", status: "ERROR", organizationId: "org-1",
          lastError: "boom", lastSyncAt: hoursAgo(1), createdAt: hoursAgo(100), updatedAt: hoursAgo(1),
          // Raw-row poison: must never survive into a payload.
          credential: { encryptedData: "ciphertext" }, accessToken: "tok", clientSecret: "sec",
        },
      ],
      socialAccounts: [
        { id: "sa-1", organizationId: "org-1", platform: "meta_page", name: "Page", username: "pg", status: "error", lastError: "page token dead", updatedAt: hoursAgo(1), accessToken: "tok" },
      ],
      socialPosts: [
        { id: "p-1", organizationId: "org-1", socialAccountId: "sa-1", caption: "hi", status: "failed", error: "nope", scheduledAt: null, updatedAt: hoursAgo(1) },
      ],
      adAccounts: [
        { id: "a-1", organizationId: "org-1", integrationId: "int-err", platform: "meta", sourceType: "api", name: "Acc", label: null, status: "ACTIVE", platformStatusBucket: "restricted", syncDisabled: false, updatedAt: hoursAgo(1), refreshToken: "rt" },
      ],
    });
    const service = svc(prisma);
    const payloads: any[] = [
      await service.socialBoard(),
      await service.adsBoard(),
      await service.healthIntegrations(),
    ];
    for (const payload of payloads) {
      const keys = collectKeys(JSON.parse(JSON.stringify(payload)));
      for (const key of keys) {
        expect(key).not.toMatch(/token|secret|credential|encrypted/i);
      }
      const raw = JSON.stringify(payload);
      expect(raw).not.toContain("ciphertext");
      expect(raw).not.toContain("refreshToken");
    }
  });
});

describe("AA5 — routes", () => {
  it("board routes follow the system GETs: no @AdminTier restriction", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.socialBoard)).toBeUndefined();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.adsBoard)).toBeUndefined();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.systemQueues)).toBeUndefined();
  });

  it("controller delegates to the service", async () => {
    const socialMarker = { accounts: { total: 0 } };
    const adsMarker = { total: 0 };
    const ctrl = new AdminController(
      { socialBoard: async () => socialMarker, adsBoard: async () => adsMarker } as any,
      {} as any, {} as any, {} as any,
    );
    await expect(ctrl.socialBoard()).resolves.toBe(socialMarker);
    await expect(ctrl.adsBoard()).resolves.toBe(adsMarker);
  });
});
