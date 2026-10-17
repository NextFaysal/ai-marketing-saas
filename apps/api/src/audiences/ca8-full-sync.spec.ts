import { AudiencesService } from "./audiences.service";
import { hashEmail, hashPhone } from "../conversions/conversions.service";
import { encryptJson } from "../integrations/crypto";

/**
 * Campaign Builder Advanced CA8: membership sync completion.
 *
 * EVIDENCE LABEL: every Meta call below runs against a
 * STUBBED global.fetch (the cn6 pattern) — this spec proves
 * the sync LOGIC (diff, batching, conservative skips, retry
 * state) against the documented Graph shapes: POST
 * /{audience}/users adds, DELETE /{audience}/users removes
 * with the same payload (verified from Meta's official docs
 * 2026-10-17). No live Meta call has proven this path yet.
 *
 * Conservative rules under test:
 *  - departures are deleted ONLY against a stored snapshot
 *    baseline; no snapshot = baseline sync (upload all,
 *    delete none);
 *  - an unexpectedly EMPTY source while members exist
 *    skips the whole sync — an audience is never wiped on
 *    a bad read;
 *  - a source ERROR changes nothing on Meta and is
 *    recorded on the record;
 *  - a DELETE failure keeps the departed pairs in the
 *    snapshot so the next sync retries them.
 * CA8(b): refreshAllMemberships also refreshes size/status
 * for every built record and the CA7 rollups.
 * CA8(c) spikes (documented in the acceptance doc, NOT
 * built): Google Customer Match and TikTok DMP — both
 * platforms' paths exist upstream, but this codebase's
 * Google/TikTok clients are read-only (verify + metrics),
 * so no sync is built on them and nothing is faked.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => { const out = rows.filter((r) => matches(r, where ?? {})); return take ? out.slice(0, take) : out; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
const pair = (email: string): [string, string] => [hashEmail(email) ?? "", hashPhone(null) ?? ""];
const A = pair("a@example.com");
const B = pair("b@example.com");
const C = pair("c@example.com");

function setup(opts: { deleteFails?: boolean } = {}) {
  const tables: any = {};
  for (const n of ["audienceRecord", "integration", "adAccount", "customer", "lead", "order", "audienceMembershipSnapshot", "campaignPlan", "campaignAdSet", "savedAudience", "dailyAdMetric", "audiencePerformanceRollup"]) tables[n] = makeTable(n);
  tables.integration.findFirst = async ({ where, include }: any = {}) => {
    const base = tables.integration.rows.find((r: any) => matches(r, where ?? {}));
    if (!base) return null;
    return include?.credential ? { ...base, credential: { encryptedData: encryptJson({ accessToken: "tok-test" }) } } : base;
  };
  tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", createdAt: new Date() });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "123456", integrationId: "int-1" });
  const calls: { method: string; url: string; pairs: any[] | null }[] = [];
  const state = { deleteFails: !!opts.deleteFails };
  global.fetch = (async (url: string, init: any = {}) => {
    const method = init.method ?? "GET";
    let sentPairs: any[] | null = null;
    if (init.body) {
      const payload = new URLSearchParams(String(init.body)).get("payload");
      if (payload) { try { sentPairs = JSON.parse(payload).data ?? null; } catch { sentPairs = null; } }
    }
    calls.push({ method, url: String(url), pairs: sentPairs });
    if (method === "DELETE") {
      if (state.deleteFails) return { ok: false, status: 500, json: async () => ({ error: { message: "delete boom" } }) };
      return { ok: true, status: 200, json: async () => ({ num_received: sentPairs?.length ?? 0 }) };
    }
    if (String(url).includes("/customaudiences")) return { ok: true, status: 200, json: async () => ({ id: "aud-new" }) };
    if (String(url).includes("/users")) return { ok: true, status: 200, json: async () => ({ num_received: sentPairs?.length ?? 0, num_invalid_entries: 0 }) };
    if (String(url).includes("approximate_count")) return { ok: true, status: 200, json: async () => ({ approximate_count: 4321, delivery_status: { code: 200, description: "ok" } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  const svc = new AudiencesService(tables as any, { log: async () => undefined } as any);
  return { tables, svc, calls, state };
}
function seedRecord(tables: any, over: any = {}) {
  const rec = { id: "rec-1", organizationId: "org", adAccountId: "acc-1", name: "ক্রেতা", kind: "custom", source: "customers", sourceDetail: null, externalAudienceId: "aud-1", status: "ready", lastMembershipCount: null, ...over };
  tables.audienceRecord.rows.push(rec);
  return rec;
}
function seedSnapshot(tables: any, pairs: [string, string][]) {
  tables.audienceMembershipSnapshot.rows.push({ id: "snap-1", organizationId: "org", audienceRecordId: "rec-1", pairs, memberCount: pairs.length, syncedAt: new Date() });
}
function seedCustomers(tables: any, emails: string[]) {
  tables.customer.rows.length = 0;
  for (const email of emails) tables.customer.rows.push({ id: `c-${email}`, organizationId: "org", email, phone: null, mergedIntoId: null });
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe("CA8 full membership sync (stubbed Meta client)", () => {
  it("uploads only additions and DELETES only departures against the snapshot", async () => {
    const { tables, svc, calls } = setup();
    seedRecord(tables);
    seedSnapshot(tables, [A, B]);
    seedCustomers(tables, ["a@example.com", "c@example.com"]);
    const out: any = await svc.refreshMembership("org", "u1", "rec-1");
    expect(out.added).toBe(1);
    expect(out.removed).toBe(1);
    expect(out.uploaded).toBe(1);
    expect(out.deletionsSkipped).toBe(false);
    const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/users"));
    const deletes = calls.filter((c) => c.method === "DELETE" && c.url.includes("/users"));
    expect(posts).toHaveLength(1);
    expect(posts[0].pairs).toEqual([C]);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].pairs).toEqual([B]);
    const snap = tables.audienceMembershipSnapshot.rows[0];
    expect(snap.memberCount).toBe(2);
    expect(snap.pairs).toEqual(expect.arrayContaining([A, C]));
    expect(tables.audienceRecord.rows[0].lastMembershipCount).toBe(2);
  });

  it("no snapshot = baseline sync: upload all, delete NONE, snapshot established", async () => {
    const { tables, svc, calls } = setup();
    seedRecord(tables, { lastMembershipCount: 5 });
    seedCustomers(tables, ["a@example.com", "c@example.com"]);
    const out: any = await svc.refreshMembership("org", "u1", "rec-1");
    expect(out.baselineEstablished).toBe(true);
    expect(out.uploaded).toBe(2);
    expect(out.removed).toBe(0);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(tables.audienceMembershipSnapshot.rows).toHaveLength(1);
    expect(tables.audienceMembershipSnapshot.rows[0].memberCount).toBe(2);
  });

  it("an unexpectedly EMPTY source with prior members SKIPS the sync — no POST, no DELETE, reason recorded", async () => {
    const { tables, svc, calls } = setup();
    seedRecord(tables);
    seedSnapshot(tables, [A, B]);
    seedCustomers(tables, []);
    const out: any = await svc.refreshMembership("org", "u1", "rec-1");
    expect(out.deletionsSkipped).toBe(true);
    expect(out.skipReason).toContain("মুছে ফেলা হয় না");
    expect(calls).toHaveLength(0);
    expect(tables.audienceRecord.rows[0].error).toContain("খালি");
    expect(tables.audienceMembershipSnapshot.rows[0].memberCount).toBe(2);
  });

  it("a source ERROR changes nothing on Meta and is recorded", async () => {
    const { tables, svc, calls } = setup();
    seedRecord(tables, { source: "rfm_segment", sourceDetail: null });
    seedSnapshot(tables, [A, B]);
    await expect(svc.refreshMembership("org", "u1", "rec-1")).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(tables.audienceRecord.rows[0].error).toContain("কোনো পরিবর্তন করা হয়নি");
    expect(tables.audienceMembershipSnapshot.rows[0].memberCount).toBe(2);
  });

  it("a DELETE failure keeps departures in the snapshot; the next sync retries and completes them", async () => {
    const { tables, svc, state } = setup({ deleteFails: true });
    seedRecord(tables);
    seedSnapshot(tables, [A, B]);
    seedCustomers(tables, ["a@example.com", "c@example.com"]);
    await expect(svc.refreshMembership("org", "u1", "rec-1")).rejects.toThrow(/delete boom/);
    // Snapshot = previous ∪ additions: A, B (retry), C.
    const snap1 = tables.audienceMembershipSnapshot.rows[0];
    expect(snap1.memberCount).toBe(3);
    expect(snap1.pairs).toEqual(expect.arrayContaining([A, B, C]));
    state.deleteFails = false;
    const out: any = await svc.refreshMembership("org", "u1", "rec-1");
    expect(out.removed).toBe(1);
    expect(out.added).toBe(0);
    expect(tables.audienceMembershipSnapshot.rows[0].pairs).toEqual(expect.arrayContaining([A, C]));
    expect(tables.audienceMembershipSnapshot.rows[0].memberCount).toBe(2);
  });

  it("createCustom seeds the snapshot, so the first refresh can diff immediately", async () => {
    const { tables, svc } = setup();
    seedCustomers(tables, ["a@example.com", "c@example.com"]);
    const rec: any = await svc.createCustom("org", "u1", { adAccountId: "acc-1", name: "নতুন", source: "customers" });
    // createCustom's real contract: the Meta id is set and
    // status stays "building" until a size/status refresh
    // confirms delivery — the snapshot is what CA8 adds.
    expect(rec.externalAudienceId).toBe("aud-new");
    expect(rec.status).toBe("building");
    expect(tables.audienceMembershipSnapshot.rows).toHaveLength(1);
    expect(tables.audienceMembershipSnapshot.rows[0].audienceRecordId).toBe(rec.id);
    expect(tables.audienceMembershipSnapshot.rows[0].memberCount).toBe(2);
  });

  it("refreshAllMemberships: membership + size/status for every built record + CA7 rollups in one run", async () => {
    const { tables, svc } = setup();
    seedRecord(tables);
    seedSnapshot(tables, [A]);
    tables.audienceRecord.rows.push({ id: "rec-lal", organizationId: "org", adAccountId: "acc-1", name: "Lookalike", kind: "lookalike", source: "meta", sourceDetail: null, externalAudienceId: "aud-lal", status: "building", lastMembershipCount: null });
    seedCustomers(tables, ["a@example.com"]);
    const out: any = await svc.refreshAllMemberships("org", "u1");
    expect(out.refreshed).toBe(1);
    expect(out.errors).toEqual([]);
    expect(out.sizesRefreshed).toBe(2);
    expect(out.sizeErrors).toEqual([]);
    expect(out.performanceRefreshed).toBe(true);
    const lal = tables.audienceRecord.rows.find((r: any) => r.id === "rec-lal");
    expect(lal.approximateCount).toBe(4321);
    expect(lal.status).toBe("ready");
  });
});
