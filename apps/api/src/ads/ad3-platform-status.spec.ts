import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdsService } from "./ads.service";
import { MetaClient } from "./meta/meta.client";
import { GoogleAdsClient } from "./google/google.client";
import { TikTokAdsClient } from "./tiktok/tiktok.client";
import { encryptJson } from "../integrations/crypto";
import {
  metaStatusBucket, googleStatusBucket, tiktokStatusBucket,
  metaStatusInfo, googleStatusInfo, tiktokStatusInfo,
} from "./platform-status";

/**
 * AD3 — Platform Account Status + Timezone:
 * - bucket normalization per platform (documented vocabularies)
 * - client parsing of the status/timezone fields each platform
 *   genuinely returns (fetch fixtures — labelled as fixtures)
 * - connect-time capture for Meta/Google/TikTok
 * - POST refresh-status: persisted update + audit, transition
 *   notification into disabled/restricted with AuditLog-marker
 *   daily dedupe, failure semantics (platform-call failure ->
 *   markSyncFailure; local precondition -> honest 400, no mark)
 * - platforms returning no status: stored status untouched
 * - serializer stays credential-free; tenant isolation
 */
const ORG = "org-1";
const ORG2 = "org-2";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (args.orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    count: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    }),
  };
}

function fakeDb() {
  const db: any = {
    accounts: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    auditRows: [] as Row[], members: [] as Row[], notifications: [] as Row[],
  };
  let seq = 0;
  db.adAccount = {
    ...table(db.accounts),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `acc-${++seq}`, createdAt: new Date(), ...data };
      db.accounts.push(row);
      return { ...row };
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.organizationId_platform_externalId;
      const found = db.accounts.find((a: Row) => a.organizationId === key.organizationId && a.platform === key.platform && a.externalId === key.externalId);
      if (found) { Object.assign(found, update); return { ...found }; }
      const row = { id: `acc-${++seq}`, createdAt: new Date(), ...create };
      db.accounts.push(row);
      return { ...row };
    }),
  };
  const integrationTable = table(db.integrations);
  db.integration = {
    ...integrationTable,
    findFirst: jest.fn(async (args: any = {}) => {
      const row = db.integrations.find((r: Row) => matches(r, args.where));
      if (!row) return null;
      const copy: Row = { ...row };
      if (args.include?.credential) {
        const cred = db.credentials.find((c: Row) => c.integrationId === row.id);
        copy.credential = cred ? { ...cred } : null;
      }
      return copy;
    }),
    findMany: jest.fn(async (args: any = {}) => {
      let rows = db.integrations.filter((r: Row) => matches(r, args.where));
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r: Row) => {
        if (args.select) {
          const out: Row = {};
          for (const k of Object.keys(args.select)) if (args.select[k]) out[k] = r[k];
          return out;
        }
        return { ...r };
      });
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `int-${++seq}`, createdAt: new Date(), ...data };
      db.integrations.push(row);
      return { ...row };
    }),
  };
  db.integrationCredential = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `cred-${++seq}`, createdAt: new Date(), ...data };
      db.credentials.push(row);
      return { ...row };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = db.credentials.length;
      for (let i = db.credentials.length - 1; i >= 0; i--) if (matches(db.credentials[i], where)) db.credentials.splice(i, 1);
      return { count: before - db.credentials.length };
    }),
  };
  db.auditLog = table(db.auditRows);
  db.membership = table(db.members);
  db.agentNotification = table(db.notifications);
  return db;
}

function auditFor(db: any) {
  return {
    log: jest.fn(async (input: any) => {
      db.auditRows.push({
        id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(),
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        action: input.action, entityType: input.entityType,
        entityId: input.entityId ?? null, metadata: input.metadata ?? null,
      });
    }),
  };
}
function service(db: any) { return new AdsService(db as any, auditFor(db) as any); }

let counter = 0;
function seedAccount(db: any, over: Row = {}): Row {
  counter++;
  const row: Row = {
    id: `acc-seed-${counter}`, organizationId: ORG, platform: "meta", sourceType: "api",
    externalId: `act_${counter}`, name: `Account ${counter}`, currency: "BDT",
    integrationId: null, status: "ACTIVE",
    platformStatusRaw: null, platformStatusBucket: null, timezone: null, platformStatusCheckedAt: null,
    createdAt: new Date(Date.now() - 100 * 3600000), ...over,
  };
  db.accounts.push(row);
  return row;
}
function seedIntegration(db: any, over: Row = {}): Row {
  counter++;
  const row: Row = {
    id: `int-seed-${counter}`, organizationId: ORG, provider: "meta", status: "CONNECTED",
    externalAccountId: "user-1", lastSyncAt: new Date(), lastError: null,
    createdAt: new Date(Date.now() - 100 * 3600000), ...over,
  };
  db.integrations.push(row);
  return row;
}
function seedMembers(db: any) {
  db.members.push(
    { id: "m1", organizationId: ORG, userId: "owner-1", role: "OWNER", status: "ACTIVE", createdAt: new Date() },
    { id: "m2", organizationId: ORG, userId: "admin-1", role: "ADMIN", status: "ACTIVE", createdAt: new Date() },
    { id: "m3", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: new Date() },
    { id: "m4", organizationId: ORG, userId: "gone-1", role: "ADMIN", status: "SUSPENDED", createdAt: new Date() },
  );
}
function seedConnectedMeta(db: any, accountOver: Row = {}) {
  const integration = seedIntegration(db);
  const account = seedAccount(db, { integrationId: integration.id, ...accountOver });
  db.credentials.push({ id: `cred-${account.id}`, integrationId: integration.id, encryptedData: encryptJson({ accessToken: "tok-meta" }) });
  return { integration, account };
}
function scanKeys(value: any, hits: string[] = []): string[] {
  if (Array.isArray(value)) { value.forEach((v) => scanKeys(v, hits)); return hits; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { hits.push(k); scanKeys(v, hits); }
  }
  return hits;
}

afterEach(() => jest.restoreAllMocks());

describe("bucket normalization (documented vocabularies)", () => {
  it("maps Meta account_status codes", () => {
    expect(metaStatusBucket(1)).toBe("active");
    expect(metaStatusBucket(2)).toBe("disabled");
    expect(metaStatusBucket(101)).toBe("disabled");
    for (const c of [3, 7, 8, 9, 100]) expect(metaStatusBucket(c)).toBe("restricted");
    expect(metaStatusBucket(999)).toBe("unknown");
    expect(metaStatusInfo(undefined)).toEqual({ raw: null, bucket: null, timezone: null });
    expect(metaStatusInfo(2, "Asia/Dhaka")).toEqual({ raw: "2", bucket: "disabled", timezone: "Asia/Dhaka" });
  });
  it("maps Google CustomerStatus values; absent stays null", () => {
    expect(googleStatusBucket("ENABLED")).toBe("active");
    expect(googleStatusBucket("SUSPENDED")).toBe("restricted");
    expect(googleStatusBucket("CANCELED")).toBe("disabled");
    expect(googleStatusBucket("CLOSED")).toBe("disabled");
    expect(googleStatusBucket("UNSPECIFIED")).toBe("unknown");
    expect(googleStatusInfo(undefined, "Asia/Dhaka")).toEqual({ raw: null, bucket: null, timezone: "Asia/Dhaka" });
  });
  it("maps TikTok advertiser status values; absent stays null", () => {
    expect(tiktokStatusBucket("STATUS_ENABLE")).toBe("active");
    expect(tiktokStatusBucket("STATUS_DISABLE")).toBe("disabled");
    expect(tiktokStatusBucket("STATUS_PENDING_CONFIRM")).toBe("restricted");
    expect(tiktokStatusBucket("STATUS_CONFIRM_FAIL")).toBe("restricted");
    expect(tiktokStatusBucket("STATUS_WHATEVER")).toBe("unknown");
    expect(tiktokStatusInfo(undefined)).toEqual({ raw: null, bucket: null, timezone: null });
  });
});

describe("client parsing (labelled fixtures)", () => {
  it("MetaClient parses timezone_name from the discovery payload", async () => {
    const fn = async (url: string) => {
      expect(url).toContain("timezone_name");
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "act_9", name: "Shop", currency: "BDT", account_status: 3, timezone_name: "Asia/Dhaka" }] }) } as any;
    };
    const client = new MetaClient("tok", fn as any);
    const list = await client.listAdAccounts();
    expect(list[0]).toMatchObject({ externalId: "act_9", status: 3, timezone: "Asia/Dhaka" });
  });
  it("GoogleAdsClient returns status + timeZone from the customer resource", async () => {
    const fn = async (url: string) => {
      if (url.includes("oauth2.googleapis.com")) return { ok: true, status: 200, json: async () => ({ access_token: "at-1" }) } as any;
      return { ok: true, status: 200, json: async () => ({ id: "1234567890", descriptiveName: "Shop", currencyCode: "BDT", status: "SUSPENDED", timeZone: "Asia/Dhaka" }) } as any;
    };
    const client = new GoogleAdsClient({ clientId: "c", clientSecret: "s", refreshToken: "r", developerToken: "d" }, fn as any);
    const customer = await client.verifyCustomer("123-456-7890");
    expect(customer).toMatchObject({ status: "SUSPENDED", timeZone: "Asia/Dhaka" });
  });
  it("TikTokAdsClient requests and returns status + timezone", async () => {
    const fn = async (url: string) => {
      expect(url).toContain("status");
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { list: [{ id: 777, name: "Shop TT", currency: "BDT", status: "STATUS_DISABLE", timezone: "Asia/Dhaka" }] } }) } as any;
    };
    const client = new TikTokAdsClient("tok", fn as any);
    const adv = await client.verifyAdvertiser("777");
    expect(adv).toMatchObject({ status: "STATUS_DISABLE", timezone: "Asia/Dhaka" });
  });
});

describe("connect-time capture", () => {
  it("connectMeta stores raw/bucket/timezone + checkedAt from discovery", async () => {
    const db = fakeDb(); seedMembers(db);
    jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-9", name: "Owner" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([
      { externalId: "act_1", name: "Main", currency: "BDT", status: 1, timezone: "Asia/Dhaka" },
      { externalId: "act_2", name: "Old Shop", currency: "BDT", status: 2, timezone: "Asia/Dhaka" },
    ]);
    const res = await service(db).connectMeta(ORG, "owner-1", { accessToken: "tok" } as any);
    const [a1, a2] = res.connectedAccounts as any[];
    expect(a1).toMatchObject({ platformStatusRaw: "1", platformStatusBucket: "active", timezone: "Asia/Dhaka" });
    expect(a1.platformStatusCheckedAt).toBeInstanceOf(Date);
    expect(a2).toMatchObject({ platformStatusRaw: "2", platformStatusBucket: "disabled" });
    // transition into disabled at connect notifies OWNER+ADMIN once each
    const notes = db.notifications.filter((n: Row) => n.type === "ad_account_platform_status");
    expect(notes.map((n: Row) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    expect(notes[0].body).toContain("Old Shop");
  });

  it("connectGoogle stores a SUSPENDED customer as restricted and notifies", async () => {
    const db = fakeDb(); seedMembers(db);
    jest.spyOn(GoogleAdsClient.prototype, "verifyCustomer").mockResolvedValue({
      id: "1234567890", descriptiveName: "Shop G", currencyCode: "BDT", status: "SUSPENDED", timeZone: "Asia/Dhaka",
    });
    const res = await service(db).connectGoogle(ORG, "owner-1", {
      customerId: "123-456-7890", clientId: "c", clientSecret: "s", refreshToken: "r", developerToken: "d",
    } as any);
    expect(res.connectedAccounts[0]).toMatchObject({ platformStatusRaw: "SUSPENDED", platformStatusBucket: "restricted", timezone: "Asia/Dhaka" });
    expect(db.notifications.filter((n: Row) => n.type === "ad_account_platform_status")).toHaveLength(2);
  });

  it("connectTikTok stores STATUS_DISABLE as disabled; no status -> stays null", async () => {
    const db = fakeDb(); seedMembers(db);
    const spy = jest.spyOn(TikTokAdsClient.prototype, "verifyAdvertiser");
    spy.mockResolvedValueOnce({ id: "777", name: "TT", currency: "BDT", status: "STATUS_DISABLE", timezone: "Asia/Dhaka" });
    const res = await service(db).connectTikTok(ORG, "owner-1", { advertiserId: "777", accessToken: "tok" } as any);
    expect(res.connectedAccounts[0]).toMatchObject({ platformStatusRaw: "STATUS_DISABLE", platformStatusBucket: "disabled", timezone: "Asia/Dhaka" });
    spy.mockResolvedValueOnce({ id: "888", name: "TT2", currency: "BDT" });
    const res2 = await service(db).connectTikTok(ORG, "owner-1", { advertiserId: "888", accessToken: "tok" } as any);
    expect(res2.connectedAccounts[0].platformStatusRaw).toBeNull();
    expect(res2.connectedAccounts[0].platformStatusBucket).toBeNull();
  });
});

describe("refreshAccountStatus", () => {
  it("persists the new status, audits, and notifies once on transition into restricted", async () => {
    const db = fakeDb(); seedMembers(db);
    const { account } = seedConnectedMeta(db, { platformStatusRaw: "1", platformStatusBucket: "active" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([
      { externalId: account.externalId, name: account.name, currency: "BDT", status: 3, timezone: "Asia/Dhaka" },
    ]);
    const svc = service(db);
    const out = await svc.refreshAccountStatus(ORG, "owner-1", account.id);
    expect(out).toMatchObject({ platformStatusRaw: "3", platformStatusBucket: "restricted", timezone: "Asia/Dhaka", previousBucket: "active" });
    expect(out.platformStatusCheckedAt).toBeInstanceOf(Date);
    const stored = db.accounts.find((a: Row) => a.id === account.id);
    expect(stored.platformStatusBucket).toBe("restricted");
    expect(db.auditRows.some((r: Row) => r.action === "ad_account.platform_status_refresh" && r.entityId === account.id)).toBe(true);
    expect(db.notifications.filter((n: Row) => n.type === "ad_account_platform_status")).toHaveLength(2);
    // second refresh, same bucket: no transition -> no new notification
    await svc.refreshAccountStatus(ORG, "owner-1", account.id);
    expect(db.notifications.filter((n: Row) => n.type === "ad_account_platform_status")).toHaveLength(2);
  });

  it("daily marker blocks a second bad-transition notification the same Dhaka day", async () => {
    const db = fakeDb(); seedMembers(db);
    const { account } = seedConnectedMeta(db, { platformStatusRaw: "1", platformStatusBucket: "active" });
    db.auditRows.push({
      id: "marker-1", organizationId: ORG, userId: null, action: "ad_account.platform_status_notified",
      entityType: "AdAccount", entityId: account.id, createdAt: new Date(), metadata: null,
    });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([
      { externalId: account.externalId, name: account.name, currency: "BDT", status: 2, timezone: null },
    ]);
    const out = await service(db).refreshAccountStatus(ORG, "owner-1", account.id);
    expect(out.platformStatusBucket).toBe("disabled"); // status still persisted
    expect(db.notifications.filter((n: Row) => n.type === "ad_account_platform_status")).toHaveLength(0);
  });

  it("Google refresh with NO status in the response leaves stored status untouched but stamps checkedAt", async () => {
    const db = fakeDb(); seedMembers(db);
    const integration = seedIntegration(db, { provider: "google_ads" });
    const account = seedAccount(db, {
      platform: "google", externalId: "1234567890", integrationId: integration.id,
      platformStatusRaw: "SUSPENDED", platformStatusBucket: "restricted", platformStatusCheckedAt: null,
    });
    db.credentials.push({ id: "cred-g", integrationId: integration.id, encryptedData: encryptJson({ clientId: "c", clientSecret: "s", refreshToken: "r", developerToken: "d" }) });
    jest.spyOn(GoogleAdsClient.prototype, "verifyCustomer").mockResolvedValue({ id: "1234567890", descriptiveName: "Shop G", currencyCode: "BDT" });
    const out = await service(db).refreshAccountStatus(ORG, "owner-1", account.id);
    expect(out.platformStatusRaw).toBe("SUSPENDED");
    expect(out.platformStatusBucket).toBe("restricted");
    expect(out.platformStatusCheckedAt).toBeInstanceOf(Date);
    expect(db.notifications).toHaveLength(0);
  });

  it("platform-call failure marks the integration ERROR (AD1 path) and surfaces the verbatim error", async () => {
    const db = fakeDb(); seedMembers(db);
    const { integration, account } = seedConnectedMeta(db, { platformStatusBucket: "active", platformStatusRaw: "1" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockRejectedValue(new Error("Invalid OAuth access token - cannot parse access token"));
    await expect(service(db).refreshAccountStatus(ORG, "owner-1", account.id))
      .rejects.toThrow(/Invalid OAuth access token/);
    const stored = db.integrations.find((i: Row) => i.id === integration.id);
    expect(stored.status).toBe("ERROR");
    expect(stored.lastError).toContain("Invalid OAuth access token");
  });

  it("account no longer visible to the token: honest 400, integration NOT marked", async () => {
    const db = fakeDb(); seedMembers(db);
    const { integration, account } = seedConnectedMeta(db, {});
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([]);
    await expect(service(db).refreshAccountStatus(ORG, "owner-1", account.id)).rejects.toMatchObject({ code: "ads.metaNoLongerShowsTheAccount" });
    expect(db.integrations.find((i: Row) => i.id === integration.id).status).toBe("CONNECTED");
  });

  it("manual/csv accounts cannot refresh; another org's account is a 404", async () => {
    const db = fakeDb(); seedMembers(db);
    const manual = seedAccount(db, { sourceType: "csv", integrationId: null, externalId: null });
    await expect(service(db).refreshAccountStatus(ORG, "owner-1", manual.id)).rejects.toMatchObject({ code: "ads.thisAdAccountHasNoApi" });
    const foreign = seedAccount(db, { organizationId: ORG2 });
    await expect(service(db).refreshAccountStatus(ORG, "owner-1", foreign.id)).rejects.toMatchObject({ code: "ads.adAccountNotFoundInThis" });
  });
});

describe("serializer safety (extends AD1)", () => {
  it("listAccounts output carries the new status fields and no credential-shaped keys", async () => {
    const db = fakeDb(); seedMembers(db);
    const { account } = seedConnectedMeta(db, {
      platformStatusRaw: "2", platformStatusBucket: "disabled", timezone: "Asia/Dhaka", platformStatusCheckedAt: new Date(),
    });
    const out = await service(db).listAccounts(ORG);
    const row = out.find((a: any) => a.id === account.id);
    expect(row).toMatchObject({ platformStatusRaw: "2", platformStatusBucket: "disabled", timezone: "Asia/Dhaka" });
    const json = JSON.stringify(out);
    const bad = scanKeys(out).filter((k) => /credential|encrypted|token|secret/i.test(k));
    expect(bad).toEqual([]);
    expect(json).not.toContain("tok-meta");
  });
});
