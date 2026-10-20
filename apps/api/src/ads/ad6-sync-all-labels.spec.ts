/**
 * AD6 — bulk sync-all + account labels (see
 * docs/ad-accounts-ad6-acceptance.md).
 *
 * Sync-all: every org account gets a per-account result; one
 * account's platform failure is recorded verbatim and NEVER fails
 * the batch; disabled accounts skip as skipped_disabled; manual/csv
 * accounts (and api rows with no integration) skip as
 * skipped_no_connection; the whole batch is audited ONCE with the
 * counts; execution is sequential (account A's platform calls all
 * finish before account B's begin).
 *
 * Labels: the AD5 settings endpoint also carries `label` — trimmed,
 * capped at 60 chars, null/"" clears, audited with the result.
 */
import { AdsService } from "./ads.service";
import { MetaClient } from "./meta/meta.client";
import { encryptJson } from "../integrations/crypto";

const ORG = "org-1";
const ACTOR = "user-1";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const inner = Object.entries(v as Record<string, unknown>);
      if (inner.every(([op]) => ["in", "not", "gt", "gte", "lt", "lte", "equals", "contains", "startsWith"].includes(op))) {
        return inner.every(([op, val]) => {
          if (op === "in") return (val as unknown[]).includes(row[k]);
          if (op === "not") return row[k] !== val;
          if (op === "gt") return row[k] > (val as never);
          if (op === "gte") return row[k] >= (val as never);
          if (op === "lt") return row[k] < (val as never);
          if (op === "lte") return row[k] <= (val as never);
          if (op === "equals") return row[k] === val;
          if (op === "contains") return String(row[k] ?? "").includes(String(val));
          if (op === "startsWith") return String(row[k] ?? "").startsWith(String(val));
          return true;
        });
      }
      return matches(row[k] ?? {}, v);
    }
    if (k === "OR") return (v as unknown[]).some((w) => matches(row, w));
    if (k === "AND") return (v as unknown[]).every((w) => matches(row, w));
    if (k === "NOT") return !matches(row, v);
    return row[k] === v;
  });
}

function table(seed: any[] = []) {
  const rows: any[] = seed.map((r, i) => ({ id: r.id ?? `row-${i + 1}`, createdAt: r.createdAt ?? new Date(1000 * (i + 1)), updatedAt: r.updatedAt ?? new Date(), ...r }));
  let seq = rows.length;
  const applyData = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v !== null && typeof v === "object" && !Array.isArray(v) && "increment" in (v as object)) row[k] = (row[k] ?? 0) + (v as any).increment;
      else if (v !== null && typeof v === "object" && !Array.isArray(v) && "set" in (v as object)) row[k] = (v as any).set;
      else row[k] = v;
    }
    row.updatedAt = new Date();
  };
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => matches(r, args.where));
      if (args.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0] ?? [];
        if (field) out = [...out].sort((a, b) => (dir === "desc" ? (a[field] < b[field] ? 1 : -1) : a[field] > b[field] ? 1 : -1));
      }
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => rows.find((r) => matches(r, args.where)) ?? null,
    findUnique: async (args: any = {}) => rows.find((r) => matches(r, args.where)) ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where)) { applyData(row, data); count++; }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const found = rows.find((r) => matches(r, where));
      if (found) { applyData(found, update); return found; }
      const row = { id: create.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); count++; }
      return { count };
    },
    count: async (args: any = {}) => rows.filter((r) => matches(r, args.where)).length,
  };
}

function makeDb(seed: Record<string, any[]> = {}) {
  const db: any = {
    organization: table([{ id: ORG, name: "Shop" }]),
    adAccount: table(seed.adAccount ?? []),
    adCampaign: table(seed.adCampaign ?? []),
    dailyAdMetric: table([]),
    integration: table(seed.integration ?? []),
    integrationCredential: table(seed.integrationCredential ?? []),
    membership: table([{ id: "m-1", organizationId: ORG, userId: ACTOR, role: "OWNER", status: "ACTIVE" }]),
    agentNotification: table([]),
    auditLog: table([]),
  };
  // The service loads integrations with `include: { credential: true }`.
  const origFindFirst = db.integration.findFirst;
  db.integration.findFirst = async (args: any = {}) => {
    const row = await origFindFirst(args);
    if (row && args.include?.credential) {
      const cred = db.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
      return { ...row, credential: cred ? { ...cred } : null };
    }
    return row;
  };
  db.$transaction = async (fnOrArr: any) => (Array.isArray(fnOrArr) ? Promise.all(fnOrArr) : fnOrArr(db));
  return db;
}

function credRow(integrationId: string, payload: Record<string, unknown>) {
  return { id: `cred-${integrationId}`, integrationId, encryptedData: encryptJson(payload) };
}

const metaAccountRow = (over: Record<string, unknown> = {}) => ({
  id: "acct-1", organizationId: ORG, platform: "meta", sourceType: "api", externalId: "act_1",
  name: "Meta One", currency: "BDT", status: "ACTIVE", integrationId: "int-1", syncDisabled: false,
  spendWatchEnabled: false, dailyCapMinor: null, anomalyPct: null,
  platformStatusRaw: null, platformStatusBucket: null, timezone: null, platformStatusCheckedAt: null, label: null,
  ...over,
});

function makeService(db: any) {
  const audit = {
    log: async (input: any) => {
      db.auditLog.rows.push({ id: `audit-${db.auditLog.rows.length + 1}`, createdAt: new Date(), ...input });
    },
  };
  return new AdsService(db as any, audit as any);
}

afterEach(() => jest.restoreAllMocks());

describe("AD6 sync-all: result matrix + failure isolation + one audit", () => {
  it("success / failed(verbatim) / skipped_disabled / skipped_no_connection ×2, sequential, audited once", async () => {
    const db = makeDb({
      integration: [
        { id: "int-1", organizationId: ORG, provider: "meta_ads", externalAccountId: "meta-user-1", status: "CONNECTED", credentialId: "cred-int-1" },
        { id: "int-2", organizationId: ORG, provider: "meta_ads", externalAccountId: "meta-user-2", status: "CONNECTED", credentialId: "cred-int-2" },
        { id: "int-3", organizationId: ORG, provider: "google_ads", externalAccountId: "g-1", status: "CONNECTED", credentialId: "cred-int-3" },
      ],
      integrationCredential: [
        credRow("int-1", { accessToken: "tok-A" }),
        credRow("int-2", { accessToken: "tok-B" }),
        credRow("int-3", { refreshToken: "rt", clientId: "cid", clientSecret: "cs", developerToken: "dt", customerId: "123" }),
      ],
      adAccount: [
        metaAccountRow({ id: "acct-A", createdAt: new Date(1000) }),
        metaAccountRow({ id: "acct-B", integrationId: "int-2", externalId: "act_2", name: "Meta Two", createdAt: new Date(2000) }),
        // google + disabled: skipped before any platform call
        metaAccountRow({ id: "acct-C", platform: "google", integrationId: "int-3", externalId: "123", name: "Google", syncDisabled: true, createdAt: new Date(3000) }),
        // csv account: no API connection at all
        metaAccountRow({ id: "acct-D", platform: "meta", sourceType: "csv", integrationId: null, externalId: null, name: "CSV import", createdAt: new Date(4000) }),
        // api row whose integration was detached (AD2): nothing to sync
        metaAccountRow({ id: "acct-E", integrationId: null, externalId: "act_9", name: "Detached", createdAt: new Date(5000) }),
      ],
    });
    const calls: string[] = [];
    jest.spyOn(MetaClient.prototype, "getCampaignInsights").mockImplementation(async (adAccountId: string) => {
      calls.push(`insights:${adAccountId}`);
      if (adAccountId === "act_2") throw new Error("Meta rate limited");
      return [{ campaign_id: "c1", campaign_name: "Camp", date_start: "2026-10-10", impressions: "10", clicks: "2", spend: "5.00", reach: "8" }] as any;
    });

    const out = await makeService(db).syncAllAccounts(ORG, ACTOR);

    // Every account processed, in creation order, despite B failing.
    expect(out.results.map((r) => [r.accountId, r.status])).toEqual([
      ["acct-A", "success"],
      ["acct-B", "failed"],
      ["acct-C", "skipped_disabled"],
      ["acct-D", "skipped_no_connection"],
      ["acct-E", "skipped_no_connection"],
    ]);
    // The failure carries the sync's verbatim wrapped message.
    expect(out.results[1].error).toBe("Meta insights sync ব্যর্থ হয়েছে: Meta rate limited");
    expect(out).toMatchObject({ total: 5, success: 1, failed: 1, skipped: 3 });
    // Sequential: the platform calls happen strictly in account
    // order — each account's sync is awaited before the next starts.
    expect(calls).toEqual(["insights:act_1", "insights:act_2"]);
    // Exactly ONE batch audit with the counts.
    const audits = db.auditLog.rows.filter((r: any) => r.action === "ad_accounts.sync_all");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ total: 5, success: 1, failed: 1, skipped: 3 });
    // B's own failure bookkeeping still ran (AD1 marking inside the sync).
    expect(db.integration.rows.find((r: any) => r.id === "int-2").status).toBe("ERROR");
    expect(db.integration.rows.find((r: any) => r.id === "int-1").status).toBe("CONNECTED");
  });

  it("an org with no accounts returns an empty summary and still audits once", async () => {
    const db = makeDb();
    const out = await makeService(db).syncAllAccounts(ORG, ACTOR);
    expect(out).toEqual({ total: 0, success: 0, failed: 0, skipped: 0, results: [] });
    expect(db.auditLog.rows.filter((r: any) => r.action === "ad_accounts.sync_all")).toHaveLength(1);
  });
});

describe("AD6 labels via the AD5 settings endpoint", () => {
  it("trims + stores the label, returns it, and audits the RESULTING values", async () => {
    const db = makeDb({ adAccount: [metaAccountRow()] });
    const svc = makeService(db);
    const out = await svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: "  মেইন পেজ  " });
    expect(out).toEqual({ id: "acct-1", syncDisabled: false, label: "মেইন পেজ" });
    expect(db.adAccount.rows[0].label).toBe("মেইন পেজ");
    const audit = db.auditLog.rows.find((r: any) => r.action === "ad_account.settings_update");
    expect(audit.metadata).toEqual({ syncDisabled: false, label: "মেইন পেজ" });
  });

  it("label + syncDisabled combine in one PATCH; empty string and null both clear the label", async () => {
    const db = makeDb({ adAccount: [metaAccountRow({ label: "পুরনো" })] });
    const svc = makeService(db);
    const both = await svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: "নতুন", syncDisabled: true });
    expect(both).toEqual({ id: "acct-1", syncDisabled: true, label: "নতুন" });
    expect(db.adAccount.rows[0]).toMatchObject({ label: "নতুন", syncDisabled: true });

    const cleared = await svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: "   " });
    expect(cleared.label).toBeNull();
    expect(db.adAccount.rows[0].label).toBeNull();

    await svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: "আবার" });
    const clearedNull = await svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: null });
    expect(clearedNull.label).toBeNull();
  });

  it("a label over 60 chars (after trim) → Bengali 400 and NOTHING changes", async () => {
    const db = makeDb({ adAccount: [metaAccountRow({ label: "আগের" })] });
    const svc = makeService(db);
    await expect(svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: "x".repeat(61) })).rejects.toThrow(/সর্বোচ্চ ৬০ অক্ষর/);
    expect(db.adAccount.rows[0].label).toBe("আগের");
    expect(db.auditLog.rows.filter((r: any) => r.action === "ad_account.settings_update")).toHaveLength(0);
    // Exactly 60 is fine.
    const ok = await svc.updateAccountSettings(ORG, ACTOR, "acct-1", { label: "y".repeat(60) });
    expect(ok.label).toHaveLength(60);
  });

  it("foreign-org account → 404; empty DTO returns current values without writing", async () => {
    const db = makeDb({ adAccount: [metaAccountRow({ label: "আমার", syncDisabled: true })] });
    const svc = makeService(db);
    await expect(svc.updateAccountSettings("org-2", ACTOR, "acct-1", { label: "x" })).rejects.toMatchObject({ code: "ads.adAccountNotFoundInThis" });
    const auditsBefore = db.auditLog.rows.length;
    const out = await svc.updateAccountSettings(ORG, ACTOR, "acct-1", {});
    expect(out).toEqual({ id: "acct-1", syncDisabled: true, label: "আমার" });
    expect(db.auditLog.rows.length).toBe(auditsBefore);
  });
});
