import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdsService } from "./ads.service";
import { MetaClient } from "./meta/meta.client";
import { GoogleAdsClient } from "./google/google.client";
import { encryptJson } from "../integrations/crypto";

/**
 * AD2 — Disconnect & Reconnect Lifecycle:
 * - disconnectAccount: sole-account disconnect deletes the
 *   credential + DISCONNECTs the integration (IntegrationsService
 *   semantics); shared (Meta one-token-many-accounts) disconnect
 *   detaches ONLY this account — integration + credential + the
 *   other accounts untouched; account row/campaigns/metrics stay
 * - disconnect on a csv/manual account (no integrationId) → 400
 * - foreign-org account → 404 (getAccount discipline)
 * - sync after disconnect → the honest "not connected via API"
 *   BadRequest, never a 500
 * - reconnect hygiene: a fresh connect supersedes the same
 *   platform identity's previous CONNECTED integrations
 *   (credential deleted + DISCONNECTED + audit
 *   "integration.superseded") once no account references them;
 *   the revived account row is the SAME row, status back ACTIVE
 * - Meta partial rediscovery (adAccountExternalIds deselect):
 *   the old integration still serves the non-rediscovered
 *   account, so it is NOT superseded and its credential stays
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
  };
  let seq = 0;

  db.adAccount = {
    ...table(db.accounts),
    findFirst: jest.fn(async ({ where }: any) => {
      const row = db.accounts.find((a: Row) => matches(a, where));
      return row ? { ...row } : null;
    }),
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
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a: Row, b: Row) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r: Row) => {
        if (args.select) {
          const out: Row = {};
          for (const k of Object.keys(args.select)) if (args.select[k]) out[k] = r[k];
          return out;
        }
        const copy: Row = { ...r };
        if (args.include?.credential) {
          const cred = db.credentials.find((c: Row) => c.integrationId === r.id);
          copy.credential = cred ? { ...cred } : null;
        }
        return copy;
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
  return db;
}

/** Audit stub that actually persists rows (same reasoning as AD1). */
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
function service(db: any) {
  return new AdsService(db as any, auditFor(db) as any);
}

let counter = 0;
function seedIntegration(db: any, over: Row = {}): Row {
  counter++;
  const row: Row = {
    id: `int-seed-${counter}`, organizationId: ORG, provider: "meta", status: "CONNECTED",
    externalAccountId: "user-42", lastSyncAt: new Date(), lastError: null,
    createdAt: new Date(Date.now() - 100 * 3600000), ...over,
  };
  db.integrations.push(row);
  db.credentials.push({
    id: `cred-${row.id}`, integrationId: row.id,
    encryptedData: encryptJson({ accessToken: "seed-token" }), createdAt: new Date(),
  });
  return row;
}
function seedAccount(db: any, over: Row = {}): Row {
  counter++;
  const row: Row = {
    id: `acc-seed-${counter}`, organizationId: ORG, platform: "meta", sourceType: "api",
    externalId: `act_${counter}`, name: `Account ${counter}`, currency: "BDT",
    integrationId: null, status: "ACTIVE", createdAt: new Date(), ...over,
  };
  db.accounts.push(row);
  return row;
}

afterEach(() => { jest.restoreAllMocks(); });

describe("AD2 disconnect", () => {
  it("sole-account disconnect: credential deleted, integration DISCONNECTED, account detached, data kept, audit shared:false", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db);
    const account = seedAccount(db, { integrationId: integration.id });
    db.campaigns.push({ id: "camp-1", organizationId: ORG, adAccountId: account.id, externalId: "c1", name: "Campaign 1" });
    db.metrics.push({ id: "met-1", organizationId: ORG, adAccountId: account.id, campaignExternalId: "c1", spendMinor: 12345n });

    const res = await service(db).disconnectAccount(ORG, "owner-1", account.id);

    expect(res.integrationId).toBeNull();
    expect(res.status).toBe("DISCONNECTED");
    expect(res.health).toBe("disconnected");
    expect(res.connection).toBeNull();

    const stored = db.accounts.find((a: Row) => a.id === account.id);
    expect(stored.integrationId).toBeNull();
    expect(stored.status).toBe("DISCONNECTED");
    // data never deleted
    expect(db.accounts).toHaveLength(1);
    expect(db.campaigns).toHaveLength(1);
    expect(db.metrics).toHaveLength(1);
    expect(db.metrics[0].spendMinor).toBe(12345n);
    // full disconnect semantics on the integration
    expect(db.integrations.find((i: Row) => i.id === integration.id).status).toBe("DISCONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === integration.id)).toHaveLength(0);

    const audit = db.auditRows.find((r: Row) => r.action === "ad_account.disconnect");
    expect(audit).toBeTruthy();
    expect(audit.entityType).toBe("AdAccount");
    expect(audit.entityId).toBe(account.id);
    expect(audit.metadata).toEqual({ shared: false, integrationId: integration.id });

    // and the list now reports the AD1 disconnected band for it
    const list = await service(db).listAccounts(ORG);
    expect(list.find((a: any) => a.id === account.id).health).toBe("disconnected");
  });

  it("shared disconnect: only this account detaches — credential, integration and the other account untouched; the other account still syncs", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db);
    const a = seedAccount(db, { integrationId: integration.id, name: "Account A" });
    const b = seedAccount(db, { integrationId: integration.id, name: "Account B" });

    const res = await service(db).disconnectAccount(ORG, "owner-1", a.id);
    expect(res.integrationId).toBeNull();
    expect(res.status).toBe("DISCONNECTED");

    // shared token survives for the other account
    expect(db.integrations.find((i: Row) => i.id === integration.id).status).toBe("CONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === integration.id)).toHaveLength(1);
    const storedB = db.accounts.find((x: Row) => x.id === b.id);
    expect(storedB.integrationId).toBe(integration.id);
    expect(storedB.status).toBe("ACTIVE");

    const audit = db.auditRows.find((r: Row) => r.action === "ad_account.disconnect");
    expect(audit.metadata).toEqual({ shared: true, integrationId: integration.id });

    // proof the shared credential still works: B syncs successfully
    jest.spyOn(MetaClient.prototype, "getCampaignInsights").mockResolvedValue([]);
    const syncRes = await service(db).syncMetaInsights(ORG, "owner-1", b.id, {});
    expect(syncRes.rows).toBe(0);
  });

  it("disconnect on a csv/manual account (no integrationId) → BadRequest 400", async () => {
    const db = fakeDb();
    const csv = seedAccount(db, { sourceType: "csv", integrationId: null });
    const manual = seedAccount(db, { sourceType: "manual", platform: "manual", integrationId: null });
    const svc = service(db);
    const err1 = await svc.disconnectAccount(ORG, "owner-1", csv.id).catch((e) => e);
    expect(err1).toBeInstanceOf(BadRequestException);
    expect(err1.getStatus()).toBe(400);
    expect(err1.message).toContain("কোনো API সংযোগ নেই");
    const err2 = await svc.disconnectAccount(ORG, "owner-1", manual.id).catch((e) => e);
    expect(err2).toBeInstanceOf(BadRequestException);
    expect(err2.getStatus()).toBe(400);
    expect(db.auditRows.filter((r: Row) => r.action === "ad_account.disconnect")).toHaveLength(0);
  });

  it("disconnect on a foreign-org account → NotFound 404", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db, { organizationId: ORG2 });
    const foreign = seedAccount(db, { organizationId: ORG2, integrationId: integration.id });
    const err = await service(db).disconnectAccount(ORG, "owner-1", foreign.id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
    // nothing was touched
    expect(db.accounts.find((a: Row) => a.id === foreign.id).integrationId).toBe(integration.id);
    expect(db.credentials).toHaveLength(1);
  });

  it("sync after disconnect throws the honest 'not connected via API' BadRequest, not a 500", async () => {
    const db = fakeDb();
    const integration = seedIntegration(db);
    const account = seedAccount(db, { integrationId: integration.id });
    const svc = service(db);
    await svc.disconnectAccount(ORG, "owner-1", account.id);
    const err = await svc.syncMetaInsights(ORG, "owner-1", account.id, {}).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toContain("not connected to Meta via API");
  });
});

describe("AD2 reconnect hygiene", () => {
  function stubMeta(discovered: Row[]) {
    jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-42", name: "Token User" });
    jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue(discovered as any);
  }

  it("Meta reconnect supersedes the old integration: credential deleted, DISCONNECTED, account repointed + ACTIVE, exactly one CONNECTED, audit written", async () => {
    const db = fakeDb();
    const old = seedIntegration(db, { externalAccountId: "user-42" });
    const account = seedAccount(db, { integrationId: old.id, externalId: "act_1", status: "DISCONNECTED", name: "Old Name" });
    stubMeta([{ externalId: "act_1", name: "Account One", currency: "BDT", status: 1 }]);

    const res = await service(db).connectMeta(ORG, "owner-1", { accessToken: "fresh-token" } as any);
    const newId = res.integrationId;
    expect(newId).not.toBe(old.id);

    // the SAME account row revived on the NEW integration
    expect(db.accounts).toHaveLength(1);
    const stored = db.accounts.find((a: Row) => a.id === account.id);
    expect(stored.integrationId).toBe(newId);
    expect(stored.status).toBe("ACTIVE");
    expect(stored.sourceType).toBe("api");

    // old integration superseded
    expect(db.integrations.find((i: Row) => i.id === old.id).status).toBe("DISCONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === old.id)).toHaveLength(0);
    expect(db.credentials.filter((c: Row) => c.integrationId === newId)).toHaveLength(1);

    // exactly one CONNECTED meta integration for this identity
    const connected = db.integrations.filter((i: Row) => i.organizationId === ORG && i.provider === "meta" && i.externalAccountId === "user-42" && i.status === "CONNECTED");
    expect(connected).toHaveLength(1);
    expect(connected[0].id).toBe(newId);

    const audit = db.auditRows.find((r: Row) => r.action === "integration.superseded");
    expect(audit).toBeTruthy();
    expect(audit.entityType).toBe("Integration");
    expect(audit.entityId).toBe(old.id);
    expect(audit.metadata).toEqual({ byIntegrationId: newId, provider: "meta" });
  });

  it("Meta partial rediscovery: non-rediscovered account keeps the old integration alive — NOT superseded, credential intact", async () => {
    const db = fakeDb();
    const old = seedIntegration(db, { externalAccountId: "user-42" });
    const a = seedAccount(db, { integrationId: old.id, externalId: "act_1", name: "Account A" });
    const b = seedAccount(db, { integrationId: old.id, externalId: "act_2", name: "Account B" });
    // the token CAN see both accounts, but the connect deselects B
    stubMeta([
      { externalId: "act_1", name: "Account A", currency: "BDT", status: 1 },
      { externalId: "act_2", name: "Account B", currency: "BDT", status: 1 },
    ]);

    const res = await service(db).connectMeta(ORG, "owner-1", { accessToken: "fresh-token", adAccountExternalIds: ["act_1"] } as any);

    const storedA = db.accounts.find((x: Row) => x.id === a.id);
    expect(storedA.integrationId).toBe(res.integrationId);
    expect(storedA.status).toBe("ACTIVE");
    // B was NOT silently repointed
    const storedB = db.accounts.find((x: Row) => x.id === b.id);
    expect(storedB.integrationId).toBe(old.id);
    // old integration still serves B → remains CONNECTED, credential intact
    expect(db.integrations.find((i: Row) => i.id === old.id).status).toBe("CONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === old.id)).toHaveLength(1);
    expect(db.auditRows.filter((r: Row) => r.action === "integration.superseded")).toHaveLength(0);
  });

  it("a different Meta identity's integration is never superseded", async () => {
    const db = fakeDb();
    const other = seedIntegration(db, { externalAccountId: "someone-else" });
    seedAccount(db, { integrationId: other.id, externalId: "act_9" });
    stubMeta([{ externalId: "act_1", name: "Account One", currency: "BDT", status: 1 }]);
    await service(db).connectMeta(ORG, "owner-1", { accessToken: "fresh-token" } as any);
    expect(db.integrations.find((i: Row) => i.id === other.id).status).toBe("CONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === other.id)).toHaveLength(1);
    expect(db.auditRows.filter((r: Row) => r.action === "integration.superseded")).toHaveLength(0);
  });

  it("Google reconnect supersedes the previous integration for the same customer identity", async () => {
    const db = fakeDb();
    const old = seedIntegration(db, { provider: "google_ads", externalAccountId: "1234567890" });
    const account = seedAccount(db, {
      platform: "google", integrationId: old.id, externalId: "1234567890", status: "DISCONNECTED", name: "Old Google",
    });
    jest.spyOn(GoogleAdsClient.prototype, "verifyCustomer").mockResolvedValue({ id: "1234567890", descriptiveName: "Google Account", currencyCode: "BDT" });

    const res = await service(db).connectGoogle(ORG, "owner-1", {
      customerId: "123-456-7890", clientId: "cid", clientSecret: "secret", refreshToken: "rt", developerToken: "dt",
    });
    const newId = res.integrationId;
    expect(newId).not.toBe(old.id);

    const stored = db.accounts.find((a: Row) => a.id === account.id);
    expect(stored.integrationId).toBe(newId);
    expect(stored.status).toBe("ACTIVE");

    expect(db.integrations.find((i: Row) => i.id === old.id).status).toBe("DISCONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === old.id)).toHaveLength(0);
    const connected = db.integrations.filter((i: Row) => i.provider === "google_ads" && i.externalAccountId === "1234567890" && i.status === "CONNECTED");
    expect(connected).toHaveLength(1);
    expect(connected[0].id).toBe(newId);

    const audit = db.auditRows.find((r: Row) => r.action === "integration.superseded");
    expect(audit).toBeTruthy();
    expect(audit.entityId).toBe(old.id);
    expect(audit.metadata).toEqual({ byIntegrationId: newId, provider: "google_ads" });
  });
});
