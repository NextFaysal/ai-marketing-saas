import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { KNOWN_FLAG_KEYS, orgFlagEnabled, planFlagDefaults } from "../common/feature-flags";

/**
 * Admin Advanced AA7 — three closings:
 *  (1) Plan-scoped feature-flag defaults: resolution matrix
 *      org row > plan default (current tier) > ON; sparse storage;
 *      unknown keys ignored on read, rejected (400) on write.
 *  (2) AI usage drill-down: org x feature aggregation from
 *      AIUsageRecord (groupBy + findMany fallback), estimated
 *      split, window clamp, CSV twin.
 *  (3) Admins roster: assembled list, legacy tier mapping,
 *      totpEnrolled boolean only — never any secret material.
 */

const SUPER: any = { id: "admin-1", email: "root@x.com", isSuperAdmin: true, adminTier: "SUPER" };
const mkAudit = (logs: any[] = []) => ({ logs, log: async (input: any) => { logs.push(input); } }) as any;

function makePrisma(opts: {
  settings?: Record<string, unknown>;
  flags?: Record<string, boolean>; // "orgId|key" -> enabled
  subPlan?: string | null;
  aiRecords?: any[];
  aiGroupByThrows?: boolean;
  users?: any[];
  orgs?: { id: string; name: string }[];
} = {}) {
  const settings = new Map<string, unknown>(Object.entries(opts.settings ?? {}));
  const flags = new Map<string, boolean>(Object.entries(opts.flags ?? {}));
  const state: any = { subPlan: opts.subPlan === undefined ? "GROWTH" : opts.subPlan };
  const aiRecords = opts.aiRecords ?? [];
  const orgs = opts.orgs ?? [{ id: "org-1", name: "Org One" }, { id: "org-2", name: 'Org, "Two"' }];

  const applyWhere = (rows: any[], where: any) => rows.filter((r) => {
    if (!where) return true;
    if (where.organizationId && r.organizationId !== where.organizationId) return false;
    if (where.estimated !== undefined && r.estimated !== where.estimated) return false;
    if (where.createdAt?.gte && !(new Date(r.createdAt) >= new Date(where.createdAt.gte))) return false;
    return true;
  });

  const prisma: any = {
    _settings: settings,
    _state: state,
    systemSetting: {
      findUnique: async ({ where }: any) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }: any) => {
        const value = update?.value ?? create?.value;
        settings.set(where.key, value);
        return { key: where.key, value };
      },
    },
    orgFeatureFlag: {
      findUnique: async ({ where }: any) => {
        const { organizationId, key } = where.organizationId_key;
        const k = organizationId + "|" + key;
        return flags.has(k) ? { organizationId, key, enabled: flags.get(k) } : null;
      },
    },
    subscription: {
      findFirst: async ({ where }: any) => {
        if (state.subPlan === null) return null;
        return { id: "sub-1", organizationId: where?.organizationId ?? "org-1", plan: state.subPlan, status: "ACTIVE", createdAt: new Date() };
      },
    },
    organization: {
      findUnique: async ({ where }: any) => orgs.find((o) => o.id === where.id) ?? null,
      findMany: async ({ where }: any) => {
        const ids = where?.id?.in as string[] | undefined;
        return orgs.filter((o) => !ids || ids.includes(o.id)).map((o) => ({ id: o.id, name: o.name }));
      },
    },
    aIUsageRecord: {
      groupBy: async ({ by, where, _count, _sum }: any) => {
        if (opts.aiGroupByThrows) throw new Error("groupBy unsupported in this fake");
        const rows = applyWhere(aiRecords, where);
        const groups = new Map<string, any>();
        for (const r of rows) {
          const gk = by.map((b: string) => String(r[b])).join("|");
          let g = groups.get(gk);
          if (!g) { g = {}; for (const b of by) g[b] = r[b]; g._count = { _all: 0 }; g._sum = { inputTokens: 0, outputTokens: 0 }; groups.set(gk, g); }
          g._count._all += 1;
          if (_sum) { g._sum.inputTokens += r.inputTokens ?? 0; g._sum.outputTokens += r.outputTokens ?? 0; }
        }
        return [...groups.values()];
      },
      findMany: async ({ where, take }: any) => applyWhere(aiRecords, where).slice(0, take),
    },
    user: {
      findMany: async ({ where, select }: any) => {
        const all = opts.users ?? [];
        const filtered = where?.isSuperAdmin === true ? all.filter((u) => u.isSuperAdmin === true) : all;
        // honour select: return only requested fields (proves the service doesn't pull secrets)
        return filtered.map((u) => {
          const out: any = {};
          for (const k of Object.keys(select ?? {})) out[k] = u[k];
          return out;
        });
      },
    },
  };
  return prisma;
}

describe("AA7 (1) — planFlagDefaults() sanitizer", () => {
  it("no setting → empty sparse map", async () => {
    expect(await planFlagDefaults(makePrisma())).toEqual({});
  });

  it("drops unknown flags, unknown tiers, non-booleans and non-object per-tier values", async () => {
    const p = makePrisma({
      settings: {
        planFlagDefaults: {
          creative_library: { FREE: false, GROWTH: "yes", PLATINUM: false },
          bogus_flag: { FREE: false },
          order_bot: "not-an-object",
          dayparting: { AGENCY: true },
        },
      },
    });
    expect(await planFlagDefaults(p)).toEqual({
      creative_library: { FREE: false },
      dayparting: { AGENCY: true },
    });
  });

  it("KNOWN_FLAG_KEYS is the six-flag allowlist and AdminService.KNOWN_FLAGS mirrors it", () => {
    expect([...KNOWN_FLAG_KEYS]).toEqual(["dayparting", "portfolio", "creative_library", "order_bot", "offline_conversions", "agency_portfolio"]);
    expect(AdminService.KNOWN_FLAGS).toEqual([...KNOWN_FLAG_KEYS]);
    expect(AdminService.KNOWN_FLAGS).not.toBe(KNOWN_FLAG_KEYS as unknown);
  });
});

describe("AA7 (1) — orgFlagEnabled resolution matrix", () => {
  const defaults = { planFlagDefaults: { creative_library: { GROWTH: false, FREE: true } } };

  it("org row OFF beats plan default ON (other flag/tier setup)", async () => {
    const p = makePrisma({ flags: { "org-1|order_bot": false }, settings: { planFlagDefaults: { order_bot: { GROWTH: true } } } });
    expect(await orgFlagEnabled(p, "org-1", "order_bot")).toBe(false);
  });

  it("org row ON beats plan default OFF", async () => {
    const p = makePrisma({ flags: { "org-1|creative_library": true }, settings: defaults });
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(true);
  });

  it("no org row → plan default for the org's current tier applies", async () => {
    const p = makePrisma({ settings: defaults, subPlan: "GROWTH" });
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(false);
  });

  it("plan default set only for another tier → falls through to ON", async () => {
    const p = makePrisma({ settings: { planFlagDefaults: { creative_library: { STARTER: false } } }, subPlan: "GROWTH" });
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(true);
  });

  it("no org row, no setting at all → ON (pre-AA7 behaviour)", async () => {
    expect(await orgFlagEnabled(makePrisma(), "org-1", "creative_library")).toBe(true);
  });

  it("tier change changes the default: same org, plan flips GROWTH → FREE", async () => {
    const p = makePrisma({ settings: defaults, subPlan: "GROWTH" });
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(false);
    p._state.subPlan = "FREE";
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(true);
  });

  it("unknown flag keys are never plan-gated (stored junk ignored); an org row still decides them", async () => {
    const p = makePrisma({ settings: { planFlagDefaults: { bogus: { GROWTH: false } } } });
    expect(await orgFlagEnabled(p, "org-1", "bogus")).toBe(true);
    const p2 = makePrisma({ flags: { "org-1|bogus": false }, settings: { planFlagDefaults: { bogus: { GROWTH: true } } } });
    expect(await orgFlagEnabled(p2, "org-1", "bogus")).toBe(false);
  });

  it("defensive: delegates missing entirely → ON", async () => {
    expect(await orgFlagEnabled({}, "org-1", "creative_library")).toBe(true);
    expect(await orgFlagEnabled({ orgFeatureFlag: { findUnique: async () => null } }, "org-1", "dayparting")).toBe(true);
  });
});

describe("AA7 (1) — write path: validation + settings round-trip", () => {
  it("rejects unknown flag / unknown tier / non-boolean / non-object with 400", async () => {
    const svc = new AdminService(makePrisma(), mkAudit());
    await expect(svc.updateSettings(SUPER, { planFlagDefaults: { nope: { FREE: true } } })).rejects.toMatchObject({ code: "admin.planflagdefaultsUnknownFlagKnown" });
    await expect(svc.updateSettings(SUPER, { planFlagDefaults: { order_bot: { PLATINUM: true } } })).rejects.toMatchObject({ code: "admin.planflagdefaultsUnknownTier" });
    await expect(svc.updateSettings(SUPER, { planFlagDefaults: { order_bot: { FREE: "yes" } } })).rejects.toMatchObject({ code: "admin.planflagdefaultsMustBeABoolean" });
    await expect(svc.updateSettings(SUPER, { planFlagDefaults: [] as any })).rejects.toMatchObject({ code: "admin.planflagdefaultsMustBeAnObject" });
    await expect(svc.updateSettings(SUPER, { planFlagDefaults: { order_bot: true as any } })).rejects.toThrow(/tier -> boolean/);
  });

  it("accepts a valid sparse map; getSettings returns it sanitized and the resolver honours it end-to-end", async () => {
    const audit = mkAudit();
    const p = makePrisma({ subPlan: "FREE" });
    const svc = new AdminService(p, audit);
    const out = await svc.updateSettings(SUPER, { planFlagDefaults: { creative_library: { FREE: false } } });
    expect((out as any).planFlagDefaults).toEqual({ creative_library: { FREE: false } });
    const got = await svc.getSettings();
    expect((got as any).planFlagDefaults).toEqual({ creative_library: { FREE: false } });
    expect(audit.logs.some((l: any) => l.action === "admin.settings_updated")).toBe(true); // logAdmin prefixes actions with "admin."
    // end-to-end: an org on FREE with no org row is now gated OFF
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(false);
    // and an empty map clears the defaults again
    await svc.updateSettings(SUPER, { planFlagDefaults: {} });
    expect(await orgFlagEnabled(p, "org-1", "creative_library")).toBe(true);
  });

  it("controller route is SUPER-gated and delegates into updateSettings", async () => {
    const tiers = Reflect.getMetadata(ADMIN_TIER_KEY, AdminController.prototype.updatePlanFlagDefaults);
    expect(tiers).toEqual(["SUPER"]);
    const calls: any[] = [];
    const ctrl = new AdminController({ updateSettings: async (...a: any[]) => { calls.push(a); return { ok: true }; } } as any, {} as any, {} as any, {} as any);
    await ctrl.updatePlanFlagDefaults({ adminUser: SUPER, ip: "1.2.3.4" }, { order_bot: { FREE: false } });
    expect(calls[0][1]).toEqual({ planFlagDefaults: { order_bot: { FREE: false } } });
  });
});

const NOW = new Date();
const rec = (organizationId: string, feature: string, inputTokens: number, outputTokens: number, estimated = false) => ({
  organizationId, feature, provider: "gemini", model: "m", inputTokens, outputTokens, estimated, createdAt: NOW,
});

describe("AA7 (2) — aiUsageDetail", () => {
  const records = [
    rec("org-1", "chat", 100, 50), rec("org-1", "chat", 300, 100, true), rec("org-1", "social_copy", 10, 5),
    rec("org-2", "chat", 1000, 500), rec("org-2", "creative_studio", 20, 10, true),
  ];

  it("groupBy path: aggregates per org x feature, merges the estimated split, sorts by tokens desc", async () => {
    const svc = new AdminService(makePrisma({ aiRecords: records }), mkAudit());
    const out = await svc.aiUsageDetail(30);
    expect(out.days).toBe(30);
    expect(out.rows[0]).toMatchObject({ organizationId: "org-2", orgName: 'Org, "Two"', feature: "chat", calls: 1, inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCalls: 0 });
    const org1Chat = out.rows.find((r) => r.organizationId === "org-1" && r.feature === "chat");
    expect(org1Chat).toMatchObject({ calls: 2, inputTokens: 400, outputTokens: 150, totalTokens: 550, estimatedCalls: 1 });
    const org1Copy = out.rows.find((r) => r.feature === "social_copy");
    expect(org1Copy).toMatchObject({ calls: 1, totalTokens: 15, estimatedCalls: 0, orgName: "Org One" });
  });

  it("organizationId filter is applied; window clamps to 90 days max and defaults sanely", async () => {
    const svc = new AdminService(makePrisma({ aiRecords: records }), mkAudit());
    const only2 = await svc.aiUsageDetail(30, "org-2");
    expect(only2.rows.every((r) => r.organizationId === "org-2")).toBe(true);
    expect(only2.totalRows).toBe(2);
    expect((await svc.aiUsageDetail(500)).days).toBe(90);
    expect((await svc.aiUsageDetail(undefined)).days).toBe(30);
    expect((await svc.aiUsageDetail(0)).days).toBe(30);
  });

  it("fallback: groupBy failure → findMany aggregation gives the same numbers", async () => {
    const svc = new AdminService(makePrisma({ aiRecords: records, aiGroupByThrows: true }), mkAudit());
    const out = await svc.aiUsageDetail(30);
    const org1Chat = out.rows.find((r) => r.organizationId === "org-1" && r.feature === "chat");
    expect(org1Chat).toMatchObject({ calls: 2, inputTokens: 400, outputTokens: 150, estimatedCalls: 1 });
    expect(out.totalRows).toBe(4);
  });

  it("CSV twin: comment header, column header, quoting for names with commas/quotes", async () => {
    const svc = new AdminService(makePrisma({ aiRecords: records }), mkAudit());
    const csv = await svc.exportAiUsageCsv(30);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("tokens/calls only");
    expect(lines[1]).toBe("organizationId,orgName,feature,calls,inputTokens,outputTokens,totalTokens,estimatedCalls");
    expect(csv).toContain('"Org, ""Two"""');
    expect(csv).toContain("org-1,");
  });
});

describe("AA7 (3) — adminsRoster", () => {
  const users = [
    { id: "u-1", email: "root@x.com", name: "Root", isSuperAdmin: true, adminTier: "SUPER", status: "ACTIVE", totpEnabled: true, lastLoginAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"), totpSecretEncrypted: "NEVER-SELECTED" },
    { id: "u-2", email: "legacy@x.com", name: null, isSuperAdmin: true, adminTier: null, status: "ACTIVE", totpEnabled: false, lastLoginAt: null, createdAt: new Date("2026-02-01T00:00:00Z"), totpSecretEncrypted: "NEVER-SELECTED" },
    { id: "u-3", email: "tenant@x.com", name: "Tenant", isSuperAdmin: false, adminTier: null, status: "ACTIVE", totpEnabled: false, lastLoginAt: null, createdAt: new Date("2026-03-01T00:00:00Z") },
  ];

  it("lists only platform admins, maps legacy null tier to SUPER, exposes totpEnrolled as a boolean", async () => {
    const svc = new AdminService(makePrisma({ users }), mkAudit());
    const out = await svc.adminsRoster();
    expect(out.admins).toHaveLength(2);
    expect(out.admins[0]).toEqual({
      id: "u-1", name: "Root", email: "root@x.com", tier: "SUPER", status: "ACTIVE",
      totpEnrolled: true, lastLoginAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(out.admins[1].tier).toBe("SUPER"); // legacy flag-only admin
    expect(out.admins[1].totpEnrolled).toBe(false);
  });

  it("no secret material anywhere in the payload", async () => {
    const svc = new AdminService(makePrisma({ users }), mkAudit());
    const json = JSON.stringify(await svc.adminsRoster());
    expect(json).not.toContain("NEVER-SELECTED");
    expect(json).not.toContain("totpSecret");
    expect(json).not.toContain("password");
  });
});
