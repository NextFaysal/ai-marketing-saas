import { AdsService } from "./ads.service";
import { MetaClient } from "./meta/meta.client";
import { encryptJson } from "../integrations/crypto";

/**
 * AD1 — Account Connection Health & Sync Visibility:
 * - listAccounts connection block + health band derivation matrix
 * - serializer safety: no credential material anywhere in the output
 * - uniform sync health writes for Meta ad-insights + breakdowns
 *   (ERROR + lastError on failure; CONNECTED + lastSyncAt +
 *   lastError=null on success) via the shared helpers
 * - failure notification: CONNECTED→ERROR transition notifies
 *   ACTIVE OWNER/ADMIN once per integration per Dhaka day
 *   (AuditLog marker), fully failure-isolated
 * - tenant isolation of listAccounts
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
      if (args.orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
    campaigns: [] as Row[], metrics: [] as Row[], breakdowns: [] as Row[],
    auditRows: [] as Row[], members: [] as Row[], notifications: [] as Row[],
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
      // Honour `select` like Prisma: only the selected keys.
      let rows = db.integrations.filter((r: Row) => matches(r, args.where));
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a: Row, b: Row) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
  db.dailyAdBreakdown = {
    findUnique: jest.fn(async ({ where }: any) => {
      const k = where.organizationId_adAccountId_date_dimension_key_campaignExternalId_source;
      const row = db.breakdowns.find((b: Row) => b.organizationId === k.organizationId && b.adAccountId === k.adAccountId &&
        new Date(b.date).getTime() === new Date(k.date).getTime() && b.dimension === k.dimension && b.key === k.key &&
        b.campaignExternalId === k.campaignExternalId && b.source === k.source);
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => { const row = { id: `bd-${++seq}`, ...data }; db.breakdowns.push(row); return { ...row }; }),
    update: jest.fn(async ({ where, data }: any) => {
      const k = where.organizationId_adAccountId_date_dimension_key_campaignExternalId_source;
      const row = db.breakdowns.find((b: Row) => b.organizationId === k.organizationId && b.adAccountId === k.adAccountId &&
        new Date(b.date).getTime() === new Date(k.date).getTime() && b.dimension === k.dimension && b.key === k.key &&
        b.campaignExternalId === k.campaignExternalId && b.source === k.source);
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    }),
  };

  db.auditLog = table(db.auditRows);
  db.membership = table(db.members);
  db.agentNotification = table(db.notifications);
  return db;
}

/** Audit stub that actually persists rows — the notification
 * dedupe marker is an AuditLog row, so the fake must behave
 * like the real AuditService (which writes AuditLog via Prisma). */
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

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);
let counter = 0;
function seedAccount(db: any, over: Row = {}): Row {
  counter++;
  const row: Row = {
    id: `acc-${counter}`, organizationId: ORG, platform: "meta", sourceType: "api",
    externalId: `act_${counter}`, name: `Account ${counter}`, currency: "BDT",
    integrationId: null, status: "ACTIVE", createdAt: hoursAgo(100), ...over,
  };
  db.accounts.push(row);
  return row;
}
function seedIntegration(db: any, over: Row = {}): Row {
  counter++;
  const row: Row = {
    id: `int-${counter}`, organizationId: ORG, provider: "meta", status: "CONNECTED",
    externalAccountId: "123", lastSyncAt: hoursAgo(1), lastError: null,
    createdAt: hoursAgo(100), ...over,
  };
  db.integrations.push(row);
  return row;
}
function seedMetaConnected(db: any, integrationOver: Row = {}) {
  const integration = seedIntegration(db, integrationOver);
  db.credentials.push({
    id: `cred-${integration.id}`, integrationId: integration.id,
    encryptedData: encryptJson({ accessToken: "test-token" }), createdAt: new Date(),
  });
  const account = seedAccount(db, { integrationId: integration.id, name: "Main Meta Account" });
  return { integration, account };
}
function seedMembers(db: any) {
  db.members.push(
    { id: "m1", organizationId: ORG, userId: "owner-1", role: "OWNER", status: "ACTIVE", createdAt: new Date() },
    { id: "m2", organizationId: ORG, userId: "admin-1", role: "ADMIN", status: "ACTIVE", createdAt: new Date() },
    { id: "m3", organizationId: ORG, userId: "viewer-1", role: "VIEWER", status: "ACTIVE", createdAt: new Date() },
    { id: "m4", organizationId: ORG, userId: "gone-1", role: "ADMIN", status: "SUSPENDED", createdAt: new Date() },
  );
}
function collectKeys(value: any, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) collectKeys(v, into); return into; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { into.add(k); collectKeys(v, into); }
  }
  return into;
}

afterEach(() => { jest.restoreAllMocks(); });

describe("AD1 health derivation matrix", () => {
  it("derives every band from status × lastSyncAt × sourceType", async () => {
    const db = fakeDb();
    const manual = seedAccount(db, { sourceType: "manual", platform: "manual", integrationId: null });
    const csv = seedAccount(db, { sourceType: "csv", integrationId: null });
    const apiNoInteg = seedAccount(db, { sourceType: "api", integrationId: null });

    const freshInteg = seedIntegration(db, { status: "CONNECTED", lastSyncAt: hoursAgo(1) });
    const fresh = seedAccount(db, { integrationId: freshInteg.id });
    const staleInteg = seedIntegration(db, { status: "CONNECTED", lastSyncAt: hoursAgo(72) });
    const stale = seedAccount(db, { integrationId: staleInteg.id });
    const nullSyncInteg = seedIntegration(db, { status: "CONNECTED", lastSyncAt: null });
    const nullSync = seedAccount(db, { integrationId: nullSyncInteg.id });
    const errInteg = seedIntegration(db, { status: "ERROR", lastSyncAt: hoursAgo(1), lastError: "token expired" });
    const errAcc = seedAccount(db, { integrationId: errInteg.id });
    const discInteg = seedIntegration(db, { status: "DISCONNECTED", lastSyncAt: hoursAgo(1) });
    const discAcc = seedAccount(db, { integrationId: discInteg.id });

    const out = await service(db).listAccounts(ORG);
    const byId = new Map(out.map((a: any) => [a.id, a]));
    expect(byId.get(manual.id).health).toBe("manual");
    expect(byId.get(csv.id).health).toBe("manual");
    expect(byId.get(apiNoInteg.id).health).toBe("disconnected");
    expect(byId.get(fresh.id).health).toBe("connected");
    expect(byId.get(stale.id).health).toBe("stale");
    expect(byId.get(nullSync.id).health).toBe("stale");
    expect(byId.get(errAcc.id).health).toBe("error");
    expect(byId.get(discAcc.id).health).toBe("disconnected");

    // connection block: present + shaped from the Integration row
    expect(byId.get(manual.id).connection).toBeNull();
    expect(byId.get(apiNoInteg.id).connection).toBeNull();
    expect(byId.get(fresh.id).connection).toEqual({
      integrationId: freshInteg.id, status: "CONNECTED",
      lastSyncAt: freshInteg.lastSyncAt, lastError: null, connectedAt: freshInteg.createdAt,
    });
    expect(byId.get(errAcc.id).connection.lastError).toBe("token expired");
  });

  it("tenant isolation: org-2 sees only its own accounts", async () => {
    const db = fakeDb();
    seedAccount(db, { organizationId: ORG });
    const other = seedAccount(db, { organizationId: ORG2 });
    const out = await service(db).listAccounts(ORG2);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(other.id);
    expect(out[0].organizationId).toBe(ORG2);
  });
});

describe("AD1 serializer safety", () => {
  it("never leaks credential material in the listAccounts response", async () => {
    const db = fakeDb();
    const { integration } = seedMetaConnected(db);
    expect(db.credentials.find((c: Row) => c.integrationId === integration.id).encryptedData).toBeTruthy();
    const out = await service(db).listAccounts(ORG);
    const keys = collectKeys(JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? String(v) : v))));
    for (const banned of ["encryptedData", "credential", "credentials", "accessToken", "token", "clientSecret", "refreshToken"]) {
      expect(keys.has(banned)).toBe(false);
    }
    const raw = JSON.stringify(out);
    expect(raw).not.toContain("encryptedData");
    expect(raw).not.toContain("accessToken");
  });
});

describe("AD1 sync health writes (Meta ad-insights + breakdowns)", () => {
  it("ad-insights failure records ERROR + lastError and rethrows the platform message", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db);
    seedMembers(db);
    jest.spyOn(MetaClient.prototype, "getAdInsights").mockRejectedValue(new Error("Invalid OAuth access token"));
    await expect(service(db).syncMetaAdInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaAdInsightsSyncFailed" });
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("ERROR");
    expect(row.lastError).toBe("Invalid OAuth access token");
  });

  it("ad-insights success marks CONNECTED + lastSyncAt + lastError null", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db, { status: "ERROR", lastError: "old error", lastSyncAt: hoursAgo(72) });
    jest.spyOn(MetaClient.prototype, "getAdInsights").mockResolvedValue([]);
    const before = Date.now();
    const res = await service(db).syncMetaAdInsights(ORG, "owner-1", account.id, {});
    expect(res.rows).toBe(0);
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("CONNECTED");
    expect(row.lastError).toBeNull();
    expect(new Date(row.lastSyncAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("breakdowns failure records ERROR + lastError and rethrows with the dimension", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db);
    jest.spyOn(MetaClient.prototype, "getBreakdownInsights").mockRejectedValue(new Error("Session expired"));
    await expect(service(db).syncMetaBreakdowns(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaBreakdownSyncFailed" });
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("ERROR");
    expect(row.lastError).toBe("Session expired");
  });

  it("breakdowns success marks CONNECTED + lastSyncAt + lastError null", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db, { status: "ERROR", lastError: "old", lastSyncAt: null });
    jest.spyOn(MetaClient.prototype, "getBreakdownInsights").mockResolvedValue([]);
    const res = await service(db).syncMetaBreakdowns(ORG, "owner-1", account.id, {});
    expect(res.rows).toBe(0);
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("CONNECTED");
    expect(row.lastError).toBeNull();
    expect(row.lastSyncAt).toBeTruthy();
  });

  it("campaign-insights failure also routes through the uniform helper", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db);
    jest.spyOn(MetaClient.prototype, "getCampaignInsights").mockRejectedValue(new Error("Rate limited"));
    await expect(service(db).syncMetaInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaInsightsSyncFailed" });
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("ERROR");
    expect(row.lastError).toBe("Rate limited");
  });
});

describe("AD1 sync-failure notification", () => {
  it("CONNECTED→ERROR transition notifies ACTIVE OWNER/ADMIN only and writes the marker", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db);
    seedMembers(db);
    const longError = `Token expired: ${"x".repeat(300)}`;
    jest.spyOn(MetaClient.prototype, "getAdInsights").mockRejectedValue(new Error(longError));
    await expect(service(db).syncMetaAdInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaAdInsightsSyncFailed" });
    expect(db.notifications).toHaveLength(2);
    expect(db.notifications.map((n: Row) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    const n = db.notifications[0];
    expect(n.type).toBe("ad_account_sync_failed");
    expect(n.title).toContain("Main Meta Account");
    expect(n.title).toContain("meta");
    // body excerpt is bounded (≤200 chars of the platform error + ellipsis)
    expect(n.body).toContain(longError.slice(0, 200));
    expect(n.body).not.toContain(longError);
    expect(n.body).toContain("পুনরায় কানেক্ট");
    const marker = db.auditRows.find((r: Row) => r.action === "ad_account.sync_failed_notified");
    expect(marker).toBeTruthy();
    expect(marker.entityType).toBe("Integration");
    expect(marker.entityId).toBe(integration.id);
  });

  it("a second failure the same day (already ERROR) creates no new notifications", async () => {
    const db = fakeDb();
    const { account } = seedMetaConnected(db);
    seedMembers(db);
    jest.spyOn(MetaClient.prototype, "getAdInsights").mockRejectedValue(new Error("still broken"));
    const svc = service(db);
    await expect(svc.syncMetaAdInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaAdInsightsSyncFailed" });
    expect(db.notifications).toHaveLength(2);
    await expect(svc.syncMetaAdInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaAdInsightsSyncFailed" });
    expect(db.notifications).toHaveLength(2);
  });

  it("a failure with today's marker already present creates no notifications", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db);
    seedMembers(db);
    db.auditRows.push({
      id: "audit-pre", organizationId: ORG, userId: null,
      action: "ad_account.sync_failed_notified", entityType: "Integration",
      entityId: integration.id, metadata: null, createdAt: new Date(),
    });
    jest.spyOn(MetaClient.prototype, "getAdInsights").mockRejectedValue(new Error("boom"));
    await expect(service(db).syncMetaAdInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaAdInsightsSyncFailed" });
    expect(db.notifications).toHaveLength(0);
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("ERROR");
  });

  it("notification store throwing does not change the sync error thrown", async () => {
    const db = fakeDb();
    const { integration, account } = seedMetaConnected(db);
    seedMembers(db);
    db.agentNotification.create = jest.fn(async () => { throw new Error("notification store down"); });
    jest.spyOn(MetaClient.prototype, "getAdInsights").mockRejectedValue(new Error("Meta is down"));
    await expect(service(db).syncMetaAdInsights(ORG, "owner-1", account.id, {})).rejects.toMatchObject({ code: "ads.metaAdInsightsSyncFailed" });
    const row = db.integrations.find((r: Row) => r.id === integration.id);
    expect(row.status).toBe("ERROR");
    expect(row.lastError).toBe("Meta is down");
  });
});
