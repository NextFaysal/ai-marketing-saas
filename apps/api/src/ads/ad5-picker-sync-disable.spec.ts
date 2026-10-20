import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdsService } from "./ads.service";
import { MetaClient } from "./meta/meta.client";
import { GoogleAdsClient } from "./google/google.client";
import { TikTokAdsClient } from "./tiktok/tiktok.client";
import { encryptJson } from "../integrations/crypto";

/**
 * AD5 — Meta Discover → Picker + Per-Account Sync Disable:
 * - discoverMetaAccounts verifies the token EXACTLY like connect
 *   (bad token = Meta's verbatim error, nothing stored), returns
 *   externalId/name/currency + the AD3 status bucket + an
 *   alreadyConnected flag (simple documented semantics: an
 *   API-sourced row with that externalId exists in THIS org — the
 *   row may be disconnected today; reconnecting revives it). The
 *   endpoint writes NOTHING and the token never appears in the
 *   response.
 * - connectMeta selection semantics: field ABSENT = legacy
 *   connect-all; PRESENT + empty = 400 Bengali (never a silent
 *   connect-all); PRESENT + no match = 400 Bengali; a partial
 *   selection connects only the chosen accounts and leaves
 *   unselected accounts' integrations/credentials untouched (the
 *   AD2 hygiene interplay, seen from the picker side).
 * - syncDisabled: PATCH flips the flag (audited); every manual
 *   platform-data sync path (meta insights / ad-insights /
 *   breakdowns, google, tiktok, refresh-status) refuses with the
 *   Bengali 400 BEFORE any platform call and WITHOUT health
 *   marking; the scheduled-job entry point syncInsightsJob
 *   returns a skip marker instead; listAccounts reports the
 *   distinct "sync_disabled" health (never decays to "stale").
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
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
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
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
  };
}

function fakeDb() {
  const db: any = {
    accounts: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    campaigns: [] as Row[], metrics: [] as Row[], auditRows: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[],
  };
  let seq = 0;

  db.adAccount = {
    ...table(db.accounts),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `acc-${++seq}`, createdAt: new Date(), syncDisabled: false, ...data };
      db.accounts.push(row);
      return { ...row };
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.organizationId_platform_externalId;
      const found = db.accounts.find((a: Row) => a.organizationId === key.organizationId && a.platform === key.platform && a.externalId === key.externalId);
      if (found) { Object.assign(found, update); return { ...found }; }
      const row = { id: `acc-${++seq}`, createdAt: new Date(), syncDisabled: false, ...create };
      db.accounts.push(row);
      return { ...row };
    }),
  };

  db.integration = {
    ...table(db.integrations),
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
      const row = { id: `int-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      db.integrations.push(row);
      return { ...row };
    }),
  };

  db.integrationCredential = {
    findFirst: jest.fn(async ({ where }: any = {}) => {
      const row = db.credentials.find((c: Row) => matches(c, where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `cred-${++seq}`, createdAt: new Date(), ...data };
      db.credentials.push(row);
      return { ...row };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = db.credentials.length;
      for (let i = db.credentials.length - 1; i >= 0; i--) {
        if (matches(db.credentials[i], where)) db.credentials.splice(i, 1);
      }
      return { count: before - db.credentials.length };
    }),
  };

  db.adCampaign = {
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.adAccountId_externalId;
      const found = db.campaigns.find((c: Row) => c.adAccountId === key.adAccountId && c.externalId === key.externalId);
      if (found) { Object.assign(found, update); return { ...found }; }
      const row = { id: `camp-${++seq}`, ...create };
      db.campaigns.push(row);
      return { ...row };
    }),
  };
  db.dailyAdMetric = {
    findUnique: jest.fn(async ({ where }: any) => {
      const k = where.organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source;
      const row = db.metrics.find((m: Row) => m.organizationId === k.organizationId && m.adAccountId === k.adAccountId &&
        m.campaignExternalId === k.campaignExternalId && (m.adSetExternalId ?? "") === k.adSetExternalId && (m.adExternalId ?? "") === k.adExternalId &&
        new Date(m.date).getTime() === new Date(k.date).getTime() && m.source === k.source);
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => { const row = { id: `met-${++seq}`, ...data }; db.metrics.push(row); return { ...row }; }),
    update: jest.fn(async ({ where, data }: any) => {
      const k = where.organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source;
      const row = db.metrics.find((m: Row) => m.organizationId === k.organizationId && m.adAccountId === k.adAccountId &&
        m.campaignExternalId === k.campaignExternalId && (m.adSetExternalId ?? "") === k.adSetExternalId && (m.adExternalId ?? "") === k.adExternalId &&
        new Date(m.date).getTime() === new Date(k.date).getTime() && m.source === k.source);
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async () => []),
  };

  db.auditLog = table(db.auditRows);
  db.membership = table(db.memberships);
  db.agentNotification = {
    create: jest.fn(async ({ data }: any) => { const row = { id: `notif-${++seq}`, ...data }; db.notifications.push(row); return { ...row }; }),
  };
  return db;
}

function service(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  return new AdsService(db as any, audit as any);
}

function seedIntegration(db: any, over: Row = {}) {
  const row = { id: `int-seed-${db.integrations.length + 1}`, organizationId: ORG, provider: "meta", status: "CONNECTED", externalAccountId: "user-42", lastSyncAt: null, lastError: null, createdAt: new Date(), ...over };
  db.integrations.push(row);
  db.credentials.push({ id: `cred-seed-${row.id}`, integrationId: row.id, encryptedData: encryptJson({ accessToken: "stored-token" }), createdAt: new Date() });
  return row;
}

function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: `acc-seed-${db.accounts.length + 1}`, organizationId: ORG, platform: "meta", sourceType: "api",
    externalId: "act_1", name: "Account One", currency: "BDT", status: "ACTIVE", integrationId: null,
    platformStatusRaw: null, platformStatusBucket: null, timezone: null, platformStatusCheckedAt: null,
    spendWatchEnabled: false, dailyCapMinor: null, anomalyPct: null, syncDisabled: false,
    createdAt: new Date(), ...over,
  };
  db.accounts.push(row);
  return row;
}

afterEach(() => jest.restoreAllMocks());

describe("AD5 discover (picker step 1)", () => {
  const DISCOVERED = [
    { externalId: "act_1", name: "Main Store", currency: "BDT", status: 1, timezone: "Asia/Dhaka" },
    { externalId: "act_2", name: "Old Shop", currency: "BDT", status: 2, timezone: null },
    { externalId: "act_3", name: "Agency Client", currency: "USD", status: 3, timezone: "America/New_York" },
  ];

  it("bad token → Meta's verbatim error, and NOTHING is stored anywhere", async () => {
    const db = fakeDb();
    jest.spyOn(MetaClient.prototype, "verifyToken").mockRejectedValue(new Error("Invalid OAuth access token - Cannot parse access token"));
    const err = await service(db).discoverMetaAccounts(ORG, { accessToken: "bad-token-value" }).catch((e) => e);
    expect(err).toMatchObject({ code: "ads.metaTokenVerificationFailed" });
    expect(err.message).toContain("Meta token verification ব্যর্থ হয়েছে: Invalid OAuth access token");
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
    expect(db.accounts).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
  });

  it("list failure after a valid token → verbatim error, still nothing stored", async () => {
    const db = fakeDb();
    jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-42" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockRejectedValue(new Error("(#100) Tried accessing nonexisting field"));
    const err = await service(db).discoverMetaAccounts(ORG, { accessToken: "some-token" }).catch((e) => e);
    expect(err).toMatchObject({ code: "ads.couldNotListMetaAdAccounts" });
    expect(err.message).toContain("Meta ad accounts তালিকা করা যায়নি: (#100)");
    expect(db.integrations).toHaveLength(0);
    expect(db.accounts).toHaveLength(0);
  });

  it("returns accounts with AD3 buckets + alreadyConnected semantics; token never appears in the response", async () => {
    const db = fakeDb();
    jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-42" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue(DISCOVERED as any);
    // act_1: api row in THIS org (disconnected today — still "already known")
    seedAccount(db, { externalId: "act_1", integrationId: null, status: "DISCONNECTED" });
    // act_2: only a CSV row with that externalId → NOT alreadyConnected
    seedAccount(db, { externalId: "act_2", sourceType: "csv", name: "CSV Twin" });
    // act_3: an api row exists but in ANOTHER org → does not count
    seedAccount(db, { externalId: "act_3", organizationId: ORG2 });

    const res = await service(db).discoverMetaAccounts(ORG, { accessToken: "super-secret-token-123" });
    expect(res.accounts).toHaveLength(3);
    const byId = new Map(res.accounts.map((a: any) => [a.externalId, a]));
    expect(byId.get("act_1")).toMatchObject({ name: "Main Store", currency: "BDT", platformStatusBucket: "active", platformStatusRaw: "1", timezone: "Asia/Dhaka", alreadyConnected: true });
    expect(byId.get("act_2")).toMatchObject({ platformStatusBucket: "disabled", alreadyConnected: false });
    expect(byId.get("act_3")).toMatchObject({ platformStatusBucket: "restricted", alreadyConnected: false });
    // the token is nowhere in the payload (value or key), and discover wrote nothing
    expect(JSON.stringify(res)).not.toContain("super-secret-token-123");
    expect(JSON.stringify(res).toLowerCase()).not.toContain("accesstoken");
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
    expect(db.accounts).toHaveLength(3); // only the seeds
  });
});

describe("AD5 connect selection semantics", () => {
  function stubMeta() {
    jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-42", name: "Token User" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([
      { externalId: "act_1", name: "Account One", currency: "BDT", status: 1, timezone: null },
      { externalId: "act_2", name: "Account Two", currency: "BDT", status: 1, timezone: null },
    ] as any);
  }

  it("PRESENT but empty selection → 400 Bengali, nothing created (never a silent connect-all)", async () => {
    const db = fakeDb(); stubMeta();
    const err = await service(db).connectMeta(ORG, "owner-1", { accessToken: "tok", adAccountExternalIds: [] } as any).catch((e) => e);
    expect(err).toMatchObject({ code: "ads.noAdAccountHasBeenSelected" });
    expect(err.message).toContain("কোনো Ad Account নির্বাচন করা হয়নি");
    expect(db.accounts).toHaveLength(0);
    expect(db.integrations).toHaveLength(0);
  });

  it("selection matching nothing under the token → 400 Bengali, nothing created", async () => {
    const db = fakeDb(); stubMeta();
    const err = await service(db).connectMeta(ORG, "owner-1", { accessToken: "tok", adAccountExternalIds: ["act_zzz"] } as any).catch((e) => e);
    expect(err).toMatchObject({ code: "ads.theSelectedAdAccountsWereNot" });
    expect(err.message).toContain("নির্বাচিত Ad Accountগুলো এই Token-এর অধীনে পাওয়া যায়নি");
    expect(db.accounts).toHaveLength(0);
    expect(db.integrations).toHaveLength(0);
  });

  it("partial selection connects ONLY the chosen account; the unselected account's integration + credential are untouched", async () => {
    const db = fakeDb(); stubMeta();
    const old = seedIntegration(db);
    const a = seedAccount(db, { externalId: "act_1", integrationId: old.id });
    const b = seedAccount(db, { externalId: "act_2", integrationId: old.id, name: "Account Two" });

    const res = await service(db).connectMeta(ORG, "owner-1", { accessToken: "tok", adAccountExternalIds: ["act_1"] } as any);
    expect(res.connectedAccounts).toHaveLength(1);
    expect(res.connectedAccounts[0].externalId).toBe("act_1");
    // chosen account repointed to the NEW integration
    expect(db.accounts.find((x: Row) => x.id === a.id).integrationId).toBe(res.integrationId);
    // unselected account: same row, same integration, integration still CONNECTED, credential intact
    const storedB = db.accounts.find((x: Row) => x.id === b.id);
    expect(storedB.integrationId).toBe(old.id);
    expect(db.integrations.find((i: Row) => i.id === old.id).status).toBe("CONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === old.id)).toHaveLength(1);
    expect(db.auditRows.filter((r: Row) => r.action === "integration.superseded")).toHaveLength(0);
  });
});

describe("AD5 syncDisabled gate", () => {
  it("PATCH flips the flag and audits it; foreign-org account → 404", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db);
    const account = seedAccount(db, { integrationId: integration.id });
    const svc = service(db);
    const res = await svc.updateAccountSettings(ORG, "owner-1", account.id, { syncDisabled: true });
    // AD6 extended this endpoint's response/audit with `label`
    // (additive; the AD5 syncDisabled behaviour is unchanged).
    expect(res).toEqual({ id: account.id, syncDisabled: true, label: null });
    expect(db.accounts.find((a: Row) => a.id === account.id).syncDisabled).toBe(true);
    const audit = db.auditRows.find((r: Row) => r.action === "ad_account.settings_update");
    expect(audit).toBeTruthy();
    expect(audit.metadata).toEqual({ syncDisabled: true, label: null });
    const err = await svc.updateAccountSettings(ORG2, "owner-1", account.id, { syncDisabled: true }).catch((e) => e);
    expect(err).toMatchObject({ code: "ads.adAccountNotFoundInThis" });
  });

  it("every manual sync path refuses BEFORE any platform call when disabled", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db);
    const account = seedAccount(db, { integrationId: integration.id, syncDisabled: true });
    const svc = service(db);
    const campaignSpy = jest.spyOn(MetaClient.prototype, "getCampaignInsights").mockResolvedValue([]);
    const adSpy = jest.spyOn(MetaClient.prototype, "getAdInsights").mockResolvedValue([]);
    const breakdownSpy = jest.spyOn(MetaClient.prototype, "getBreakdownInsights").mockResolvedValue([]);
    const listSpy = jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([]);

    for (const call of [
      () => svc.syncMetaInsights(ORG, "owner-1", account.id, {}),
      () => svc.syncMetaAdInsights(ORG, "owner-1", account.id, {}),
      () => svc.syncMetaBreakdowns(ORG, "owner-1", account.id, {}),
      () => svc.refreshAccountStatus(ORG, "owner-1", account.id),
    ]) {
      const err = await call().catch((e) => e);
      expect(err).toMatchObject({ code: "ads.thisAdAccountSSyncIs" });
      expect(err.message).toContain("Sync বন্ধ রাখা হয়েছে");
    }
    expect(campaignSpy).not.toHaveBeenCalled();
    expect(adSpy).not.toHaveBeenCalled();
    expect(breakdownSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    // a refused refresh must NOT mark the integration ERROR (AD3 local-precondition discipline)
    expect(db.integrations.find((i: Row) => i.id === integration.id).status).toBe("CONNECTED");
  });

  it("google + tiktok manual syncs refuse when disabled; enabled google account syncs normally", async () => {
    const db = fakeDb();
    const gInt = seedIntegration(db, { provider: "google_ads", externalAccountId: "1234567890" });
    db.credentials.push({ id: "cred-g", integrationId: gInt.id, encryptedData: encryptJson({ clientId: "c", clientSecret: "s", refreshToken: "r", developerToken: "d" }), createdAt: new Date() });
    const gAcc = seedAccount(db, { platform: "google", externalId: "1234567890", integrationId: gInt.id, syncDisabled: true });
    const tInt = seedIntegration(db, { provider: "tiktok", externalAccountId: "adv-1" });
    const tAcc = seedAccount(db, { platform: "tiktok", externalId: "adv-1", integrationId: tInt.id, syncDisabled: true });
    const svc = service(db);
    const gSpy = jest.spyOn(GoogleAdsClient.prototype, "getCampaignDaily").mockResolvedValue([]);
    const tSpy = jest.spyOn(TikTokAdsClient.prototype, "getCampaignDaily").mockResolvedValue([]);

    const gErr = await svc.syncGoogleInsights(ORG, "owner-1", gAcc.id, {}).catch((e) => e);
    expect(gErr).toMatchObject({ code: "ads.thisAdAccountSSyncIs" });
    expect(gErr.message).toContain("Sync বন্ধ রাখা হয়েছে");
    const tErr = await svc.syncTikTokInsights(ORG, "owner-1", tAcc.id, {}).catch((e) => e);
    expect(tErr).toMatchObject({ code: "ads.thisAdAccountSSyncIs" });
    expect(tErr.message).toContain("Sync বন্ধ রাখা হয়েছে");
    expect(gSpy).not.toHaveBeenCalled();
    expect(tSpy).not.toHaveBeenCalled();

    // flip google back on → the same call goes through
    await svc.updateAccountSettings(ORG, "owner-1", gAcc.id, { syncDisabled: false });
    const ok = await svc.syncGoogleInsights(ORG, "owner-1", gAcc.id, {});
    expect(ok).toMatchObject({ rows: 0 });
    expect(gSpy).toHaveBeenCalled();
  });

  it("syncInsightsJob: disabled → skip marker (no platform call); enabled → delegates to the manual sync", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db);
    const off = seedAccount(db, { integrationId: integration.id, syncDisabled: true, externalId: "act_off" });
    const on = seedAccount(db, { integrationId: integration.id, externalId: "act_on" });
    const svc = service(db);
    const spy = jest.spyOn(MetaClient.prototype, "getCampaignInsights").mockResolvedValue([]);

    const skipped = await svc.syncInsightsJob("meta", ORG, "owner-1", off.id);
    expect(skipped).toEqual({ skipped: true, reason: "sync_disabled", accountId: off.id, platform: "meta" });
    expect(spy).not.toHaveBeenCalled();

    const ran = await svc.syncInsightsJob("meta", ORG, "owner-1", on.id);
    expect(ran).toMatchObject({ rows: 0, created: 0, updated: 0 });
    expect(spy).toHaveBeenCalled();
  });
});

describe("AD5 health: sync_disabled is its own band", () => {
  it("disabled api account with no lastSyncAt reports sync_disabled (not stale); connection block retained", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db, { lastSyncAt: null, lastError: "old error" });
    seedAccount(db, { integrationId: integration.id, syncDisabled: true });
    const list = await service(db).listAccounts(ORG);
    expect(list).toHaveLength(1);
    expect(list[0].health).toBe("sync_disabled");
    expect(list[0].connection?.integrationId).toBe(integration.id);
    expect(list[0].connection?.lastError).toBe("old error");
  });

  it("disabled flag on a manual/csv account does not change its manual health; enabled stale account still reads stale", async () => {
    const db = fakeDb();
    seedAccount(db, { platform: "manual", sourceType: "manual", externalId: null, syncDisabled: true, name: "Manual" });
    const integration = seedIntegration(db, { lastSyncAt: null });
    seedAccount(db, { integrationId: integration.id, externalId: "act_2", name: "Stale" });
    const list = await service(db).listAccounts(ORG);
    const byName = new Map(list.map((a: any) => [a.name, a]));
    expect(byName.get("Manual").health).toBe("manual");
    expect(byName.get("Stale").health).toBe("stale");
  });
});
