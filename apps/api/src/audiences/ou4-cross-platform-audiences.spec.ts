process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { AudiencesService } from "./audiences.service";
import { encryptJson } from "../integrations/crypto";
import { hashEmail, hashPhone } from "../conversions/conversions.service";

/**
 * OU4 (part 2): cross-platform audience sync. AudiencesService
 * branches by the record's / dto's AdAccount platform (there is
 * NO platform column on AudienceRecord): Google → Customer Match,
 * TikTok → DMP custom audiences, Meta → the pre-existing Graph
 * path (regression-covered here and by audiences-cn6.spec.ts).
 * Provider clients are injected fakes through the optional third
 * constructor deps — no live account is touched.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("notIn" in v) return !(v as any).notIn.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    groupBy: async ({ by, where }: any) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      const groups = new Map<string, any[]>();
      for (const r of f) { const k = r[by[0]]; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
      return [...groups.entries()].map(([k, g]) => ({
        [by[0]]: k, _count: { _all: g.length },
        _sum: { totalMinor: g.reduce((a, r) => a + BigInt(r.totalMinor ?? 0), 0n) },
        _max: { placedAt: null, createdAt: null },
      }));
    },
  };
}

function setup() {
  const tables: any = {};
  for (const n of ["customer", "lead", "audienceRecord", "order", "trackingEvent", "visitor", "abandonedStoreCheckout", "adAccount", "integration", "integrationCredential"]) tables[n] = makeTable(n);
  tables.integration.rows.push(
    { id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-123" }) } },
    { id: "int-g", organizationId: "org", provider: "google", status: "CONNECTED", credential: { encryptedData: encryptJson({ clientId: "cid", clientSecret: "sec", refreshToken: "rt", developerToken: "dev" }) } },
    { id: "int-t", organizationId: "org", provider: "tiktok", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tt-tok" }) } },
  );
  tables.adAccount.rows.push(
    { id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", integrationId: "int-1" },
    { id: "acc-google", organizationId: "org", platform: "google", externalId: "123456", integrationId: "int-g" },
    { id: "acc-tiktok", organizationId: "org", platform: "tiktok", externalId: "adv-99", integrationId: "int-t" },
  );

  const googleCalls: any = { create: [], upload: [], get: [] };
  const googleState: any = {
    createError: null as Error | null,
    userList: { name: "Buyers", sizeForDisplay: "1200", approximateCount: 1200 },
  };
  const googleManage = {
    createCustomerMatchList: async (customerId: string, name: string, description?: string) => {
      googleCalls.create.push({ customerId, name, description });
      if (googleState.createError) throw googleState.createError;
      return { resourceName: `customers/${customerId}/userLists/789`, userListId: "789" };
    },
    uploadCustomerMatch: async (customerId: string, resourceName: string, identifiers: any[]) => {
      googleCalls.upload.push({ customerId, resourceName, identifiers });
      return { jobResourceName: `customers/${customerId}/offlineUserDataJobs/42`, operations: identifiers.length };
    },
    getUserList: async (customerId: string, userListId: string) => {
      googleCalls.get.push({ customerId, userListId });
      return googleState.userList;
    },
  };

  const tiktokCalls: any = { create: [], update: [], get: [], lookalike: [] };
  const tiktokState: any = { audience: { size: 4200, status: "PROCESSING", name: "Buyers" } };
  const tiktokManage = {
    createCustomAudience: async (advertiserId: string, name: string, hashedLines: string[]) => {
      tiktokCalls.create.push({ advertiserId, name, hashedLines });
      return { audienceExternalId: "9001", filePath: "path/abc.txt" };
    },
    updateCustomAudience: async (advertiserId: string, audienceId: string, hashedLines: string[]) => {
      tiktokCalls.update.push({ advertiserId, audienceId, hashedLines });
      return { filePath: "path/def.txt" };
    },
    getCustomAudience: async (advertiserId: string, audienceId: string) => {
      tiktokCalls.get.push({ advertiserId, audienceId });
      return tiktokState.audience;
    },
    createLookalikeAudience: async (advertiserId: string, input: any) => {
      tiktokCalls.lookalike.push({ advertiserId, input });
      return { audienceExternalId: "9002" };
    },
  };

  const auditLogs: any[] = [];
  const svc = new AudiencesService(tables as any, { log: async (e: any) => { auditLogs.push(e); } } as any, {
    googleManageFactory: (secrets: any) => { (googleCalls as any).factorySecrets = secrets; return googleManage as any; },
    tiktokManageFactory: (accessToken: string) => { (tiktokCalls as any).factoryToken = accessToken; return tiktokManage as any; },
  });
  return { tables, svc, googleCalls, googleState, tiktokCalls, tiktokState, auditLogs };
}

function seedCustomers(t: any) {
  t.customer.rows.push(
    { id: "c1", organizationId: "org", email: "a@x.com", phone: "01710000001", mergedIntoId: null },
    { id: "c2", organizationId: "org", email: "b@x.com", phone: null, mergedIntoId: null },
    { id: "c3", organizationId: "org", email: null, phone: "01710000003", mergedIntoId: null },
  );
}

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe("OU4 cross-platform audiences", () => {
  it("google custom create: list + upload called, record gets the userListId", async () => {
    const { tables, svc, googleCalls, auditLogs } = setup(); seedCustomers(tables);
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-google", name: "G Buyers", source: "customers" });
    expect(googleCalls.create).toEqual([{ customerId: "123456", name: "G Buyers", description: expect.stringContaining("customers") }]);
    expect(googleCalls.upload).toHaveLength(1);
    expect(googleCalls.upload[0].customerId).toBe("123456");
    expect(googleCalls.upload[0].resourceName).toBe("customers/123456/userLists/789");
    expect(googleCalls.upload[0].identifiers).toEqual([
      { hashedEmail: hashEmail("a@x.com"), hashedPhone: hashPhone("01710000001") },
      { hashedEmail: hashEmail("b@x.com"), hashedPhone: undefined },
      { hashedEmail: undefined, hashedPhone: hashPhone("01710000003") },
    ]);
    expect(googleCalls.factorySecrets).toMatchObject({ clientId: "cid", developerToken: "dev" });
    expect(rec.externalAudienceId).toBe("789");
    expect(rec.status).toBe("building"); // like Meta — ready only on refresh
    expect(rec.error).toBeNull();
    expect(rec.lastSyncedAt).toBeTruthy();
    expect(auditLogs.find((l) => l.action === "audience.created")?.metadata).toMatchObject({ contacts: 3, platform: "google" });
  });

  it("google failure → record failed + provider error verbatim", async () => {
    const { tables, svc, googleState } = setup(); seedCustomers(tables);
    googleState.createError = new Error("developer token not approved");
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-google", name: "G Fail", source: "customers" });
    expect(rec.status).toBe("failed");
    expect(rec.error).toBe("developer token not approved");
    expect(rec.externalAudienceId).toBeFalsy();
  });

  it("google lookalike is refused honestly (no API-created lookalike at Google)", async () => {
    const { tables, svc } = setup(); seedCustomers(tables);
    await expect(svc.createLookalike("org", "u1", {
      adAccountId: "acc-google", name: "G LAL", sourceAudienceRecordId: "whatever", country: "BD", ratio: 0.01,
    })).rejects.toThrow(/no API-created lookalike|auto-generated by Google/);
    expect(tables.audienceRecord.rows).toHaveLength(0);
  });

  it("tiktok custom create prefers email hashes (one identifier type per file)", async () => {
    const { tables, svc, tiktokCalls, auditLogs } = setup(); seedCustomers(tables);
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-tiktok", name: "TT Buyers", source: "customers" });
    expect(tiktokCalls.factoryToken).toBe("tt-tok");
    expect(tiktokCalls.create).toHaveLength(1);
    // advertiserId falls back to the account externalId (secrets carry none).
    expect(tiktokCalls.create[0].advertiserId).toBe("adv-99");
    // c3 is phone-only: dropped from an email file, never mixed in.
    expect(tiktokCalls.create[0].hashedLines).toEqual([hashEmail("a@x.com"), hashEmail("b@x.com")]);
    expect(rec.externalAudienceId).toBe("9001");
    expect(rec.error).toBeNull();
    expect(auditLogs.find((l) => l.action === "audience.created")?.metadata).toMatchObject({ platform: "tiktok" });
  });

  it("tiktok lookalike maps ratio → tier (NARROW / BALANCED / BROAD)", async () => {
    const { tables, svc, tiktokCalls } = setup();
    tables.audienceRecord.rows.push({ id: "src-tt", organizationId: "org", adAccountId: "acc-tiktok", name: "TT Source", kind: "custom", source: "customers", status: "ready", externalAudienceId: "9001" });
    const cases: [number, string][] = [[0.01, "NARROW"], [0.05, "NARROW"], [0.08, "BALANCED"], [0.10, "BALANCED"], [0.20, "BROAD"]];
    for (const [ratio, tier] of cases) {
      const rec: any = await svc.createLookalike("org", "u1", {
        adAccountId: "acc-tiktok", name: `LAL ${ratio}`, sourceAudienceRecordId: "src-tt", country: "BD", ratio,
      });
      expect(rec.externalAudienceId).toBe("9002");
      expect(rec.source).toBe("tiktok");
      expect(rec.kind).toBe("lookalike");
      const call = tiktokCalls.lookalike[tiktokCalls.lookalike.length - 1];
      expect(call.input).toMatchObject({ sourceAudienceId: "9001", country: "BD", tier });
      expect(call.advertiserId).toBe("adv-99");
    }
    expect(tiktokCalls.lookalike.map((c: any) => c.input.tier)).toEqual(cases.map((c) => c[1]));
  });

  it("tiktok lookalike refuses a source that is not a TikTok audience", async () => {
    const { tables, svc } = setup();
    tables.audienceRecord.rows.push({ id: "src-meta", organizationId: "org", adAccountId: "acc-1", name: "Meta Source", kind: "custom", source: "customers", status: "ready", externalAudienceId: "aud-meta" });
    await expect(svc.createLookalike("org", "u1", {
      adAccountId: "acc-tiktok", name: "X", sourceAudienceRecordId: "src-meta", country: "BD", ratio: 0.01,
    })).rejects.toThrow(/TikTok ad account/);
  });

  it("refresh google: numeric size updates the count, a range keeps the old count", async () => {
    const { tables, svc, googleState } = setup();
    tables.audienceRecord.rows.push({ id: "rec-g", organizationId: "org", adAccountId: "acc-google", name: "G", kind: "custom", source: "customers", status: "building", externalAudienceId: "789", approximateCount: 10 });
    const numeric: any = await svc.refresh("org", "rec-g");
    expect(numeric.approximateCount).toBe(1200);
    expect(numeric.status).toBe("ready");
    expect(numeric.lastSyncedAt).toBeTruthy();
    // size_for_display as a range: the client parses no number, so
    // the service must keep the provider-confirmed count, not guess.
    googleState.userList = { name: "G", sizeForDisplay: "1,000 - 5,000", approximateCount: null };
    const ranged: any = await svc.refresh("org", "rec-g");
    expect(ranged.approximateCount).toBe(1200);
    expect(ranged.status).toBe("ready");
  });

  it("refresh tiktok: provider size updates the count, null size keeps it", async () => {
    const { tables, svc, tiktokState } = setup();
    tables.audienceRecord.rows.push({ id: "rec-t", organizationId: "org", adAccountId: "acc-tiktok", name: "T", kind: "custom", source: "customers", status: "building", externalAudienceId: "9001", approximateCount: 5 });
    const sized: any = await svc.refresh("org", "rec-t");
    expect(sized.approximateCount).toBe(4200);
    expect(sized.status).toBe("ready");
    tiktokState.audience = { size: null, status: "PROCESSING", name: "T" };
    const unsized: any = await svc.refresh("org", "rec-t");
    expect(unsized.approximateCount).toBe(4200);
  });

  it("refreshMembership google uploads to customers/{customerId}/userLists/{id} with no invented received count", async () => {
    const { tables, svc, googleCalls, auditLogs } = setup(); seedCustomers(tables);
    tables.audienceRecord.rows.push({ id: "rec-g", organizationId: "org", adAccountId: "acc-google", name: "G", kind: "custom", source: "customers", status: "ready", externalAudienceId: "789" });
    const out: any = await svc.refreshMembership("org", "u1", "rec-g");
    expect(googleCalls.upload).toHaveLength(1);
    expect(googleCalls.upload[0].resourceName).toBe("customers/123456/userLists/789");
    expect(out.uploaded).toBe(3);
    expect(out.lastMembershipCount).toBe(3);
    expect(out.lastMembershipSyncAt).toBeTruthy();
    expect(out.receivedByMeta).toBeUndefined();
    const log = auditLogs.find((l) => l.action === "audience.membership_refreshed");
    expect(log?.metadata).toMatchObject({ contacts: 3, platform: "google" });
    expect(log?.metadata.received).toBeUndefined();
  });

  it("refreshMembership tiktok updates with email hashes only", async () => {
    const { tables, svc, tiktokCalls } = setup(); seedCustomers(tables);
    tables.audienceRecord.rows.push({ id: "rec-t", organizationId: "org", adAccountId: "acc-tiktok", name: "T", kind: "custom", source: "customers", status: "ready", externalAudienceId: "9001" });
    const out: any = await svc.refreshMembership("org", "u1", "rec-t");
    expect(tiktokCalls.update).toHaveLength(1);
    expect(tiktokCalls.update[0]).toMatchObject({ advertiserId: "adv-99", audienceId: "9001" });
    expect(tiktokCalls.update[0].hashedLines).toEqual([hashEmail("a@x.com"), hashEmail("b@x.com")]);
    expect(out.uploaded).toBe(3);
    expect(out.receivedByMeta).toBeUndefined();
  });

  it("meta path regression: a meta account still creates through Graph", async () => {
    const { tables, svc } = setup(); seedCustomers(tables);
    (global as any).fetch = async (url: string, init: any) => {
      if (String(url).includes("/customaudiences") && !String(url).includes("/users")) return { ok: true, status: 200, json: async () => ({ id: "aud-meta-1" }) };
      if (String(url).includes("/users")) return { ok: true, status: 200, json: async () => ({ num_received: 1 }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-1", name: "Meta Buyers", source: "customers" });
    expect(rec.externalAudienceId).toBe("aud-meta-1");
    expect(rec.status).toBe("building");
  });
});
