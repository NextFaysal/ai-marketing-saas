import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { DEFAULT_PLAN_LIMITS, planLimits, effectiveLimits } from "../common/platform-settings";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Admin Advanced AA4 — Per-Plan Limit Editor.
 *
 * Covers:
 *  (a) planLimits() with no setting → code defaults (deep copy)
 *  (b) partial tier/field merge
 *  (c) resolution matrix via effectiveLimits: default < setting < org override
 *  (d) 0 in setting blocks (effectiveLimits returns 0, not baseline)
 *  (e) seat path: OrganizationsService.seatUsage honours setting seats
 *  (f) updateSettings validation: negative / non-integer / non-object → 400
 *  (g) updateSettings accepts planLimits and getSettings returns merged + stored
 */

const SUPER: any = { id: "admin-1", email: "root@x.com", isSuperAdmin: true, adminTier: "SUPER" };
const mkAudit = (logs: any[] = []) => ({ logs, log: async (input: any) => { logs.push(input); } }) as any;

function makePrisma(opts: {
  settings?: Record<string, unknown>;
  org?: any;
  sub?: any;
  activeMembers?: number;
} = {}) {
  const settings = new Map<string, unknown>(Object.entries(opts.settings ?? {}));
  const orgRow = opts.org ?? {
    id: "org-1",
    aiDailyLimitOverride: null,
    broadcastCapOverride: null,
    seatLimit: null,
  };
  const subRow = opts.sub === undefined
    ? { id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", createdAt: new Date() }
    : opts.sub;
  const activeMembers = opts.activeMembers ?? 1;

  const prisma: any = {
    _settings: settings,
    systemSetting: {
      findUnique: async ({ where }: any) => {
        if (!settings.has(where.key)) return null;
        return { key: where.key, value: settings.get(where.key) };
      },
      upsert: async ({ where, create, update }: any) => {
        const value = update?.value ?? create?.value;
        settings.set(where.key, value);
        return { key: where.key, value };
      },
    },
    organization: {
      findUnique: async ({ where }: any) => (where.id === orgRow.id ? orgRow : null),
    },
    subscription: {
      findFirst: async ({ where }: any) => {
        if (!subRow) return null;
        if (where?.organizationId && subRow.organizationId !== where.organizationId) return null;
        return subRow;
      },
    },
    membership: {
      count: async ({ where }: any) => {
        if (where?.status === "ACTIVE") return activeMembers;
        if (where?.status === "SUSPENDED") return 0;
        return activeMembers;
      },
    },
    memberInvitation: {
      count: async () => 0,
    },
  };
  return prisma;
}

describe("AA4 — planLimits() helper", () => {
  it("(a) no setting → defaults, and returned map is a deep copy", async () => {
    const p = makePrisma();
    const out = await planLimits(p);
    expect(out).toEqual(DEFAULT_PLAN_LIMITS);
    // Mutating the result must not mutate the constant.
    out.GROWTH.aiDaily = 99999;
    expect(DEFAULT_PLAN_LIMITS.GROWTH.aiDaily).toBe(200);
  });

  it("(b) partial tier/field merge: only GROWTH.aiDaily set", async () => {
    const p = makePrisma({ settings: { planLimits: { GROWTH: { aiDaily: 999 } } } });
    const out = await planLimits(p);
    expect(out.GROWTH).toEqual({ aiDaily: 999, broadcastCap: DEFAULT_PLAN_LIMITS.GROWTH.broadcastCap, seats: DEFAULT_PLAN_LIMITS.GROWTH.seats });
    expect(out.FREE).toEqual(DEFAULT_PLAN_LIMITS.FREE);
    expect(out.STARTER).toEqual(DEFAULT_PLAN_LIMITS.STARTER);
    expect(out.AGENCY).toEqual(DEFAULT_PLAN_LIMITS.AGENCY);
  });

  it("(b2) invalid stored values are ignored on the read path (negative, float, string)", async () => {
    const p = makePrisma({
      settings: { planLimits: { FREE: { aiDaily: -5, broadcastCap: 1.5, seats: "3" }, STARTER: "nope", GROWTH: { seats: 0 } } },
    });
    const out = await planLimits(p);
    expect(out.FREE).toEqual(DEFAULT_PLAN_LIMITS.FREE);
    expect(out.STARTER).toEqual(DEFAULT_PLAN_LIMITS.STARTER);
    // 0 is valid and must survive.
    expect(out.GROWTH.seats).toBe(0);
  });
});

describe("AA4 — effectiveLimits resolution matrix", () => {
  const baseline = { aiDaily: 111, broadcastCap: 222 };

  it("(c) default < setting < org override", async () => {
    // Default: GROWTH plan defaults.
    const p1 = makePrisma();
    const fromDefault = await effectiveLimits(p1, "org-1", baseline);
    expect(fromDefault).toMatchObject({ aiDaily: 200, broadcastCap: 1000, seats: 10, plan: "GROWTH" });

    // Setting beats default.
    const p2 = makePrisma({ settings: { planLimits: { GROWTH: { aiDaily: 55, broadcastCap: 66, seats: 7 } } } });
    const fromSetting = await effectiveLimits(p2, "org-1", baseline);
    expect(fromSetting).toMatchObject({ aiDaily: 55, broadcastCap: 66, seats: 7, plan: "GROWTH" });

    // Org override beats setting.
    const p3 = makePrisma({
      settings: { planLimits: { GROWTH: { aiDaily: 55, broadcastCap: 66, seats: 7 } } },
      org: { id: "org-1", aiDailyLimitOverride: 7, broadcastCapOverride: 8, seatLimit: 3 },
    });
    const fromOverride = await effectiveLimits(p3, "org-1", baseline);
    expect(fromOverride).toMatchObject({ aiDaily: 7, broadcastCap: 8, seats: 3, plan: "GROWTH" });
  });

  it("(d) 0 in setting blocks — returns 0, not baseline or default", async () => {
    const p = makePrisma({
      settings: { planLimits: { GROWTH: { aiDaily: 0, broadcastCap: 0, seats: 0 } } },
    });
    const out = await effectiveLimits(p, "org-1", baseline);
    expect(out.aiDaily).toBe(0);
    expect(out.broadcastCap).toBe(0);
    expect(out.seats).toBe(0);
  });

  it("(d2) 0 as org override also blocks (nullish semantics preserved)", async () => {
    const p = makePrisma({
      org: { id: "org-1", aiDailyLimitOverride: 0, broadcastCapOverride: 0, seatLimit: 0 },
    });
    const out = await effectiveLimits(p, "org-1", baseline);
    expect(out.aiDaily).toBe(0);
    expect(out.broadcastCap).toBe(0);
    expect(out.seats).toBe(0);
  });
});

describe("AA4 — seat path honours the setting", () => {
  it("(e) seatUsage returns the setting seats value for the org's plan", async () => {
    const p = makePrisma({
      settings: { planLimits: { GROWTH: { seats: 42 } } },
      activeMembers: 2,
    });
    const orgs = new OrganizationsService(p, mkAudit());
    const usage = await orgs.seatUsage("org-1");
    expect(usage.limit).toBe(42);
    expect(usage.activeMembers).toBe(2);
    expect(usage.available).toBe(40);
  });

  it("(e2) seatUsage falls back to code default when no setting exists, and org override still wins", async () => {
    const pDefault = makePrisma({ activeMembers: 1 });
    const orgsDefault = new OrganizationsService(pDefault, mkAudit());
    expect((await orgsDefault.seatUsage("org-1")).limit).toBe(DEFAULT_PLAN_LIMITS.GROWTH.seats);

    const pOverride = makePrisma({
      settings: { planLimits: { GROWTH: { seats: 42 } } },
      org: { id: "org-1", aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: 3 },
    });
    const orgsOverride = new OrganizationsService(pOverride, mkAudit());
    expect((await orgsOverride.seatUsage("org-1")).limit).toBe(3);
  });
});

describe("AA4 — AdminService settings validation + roundtrip", () => {
  it("(f) negative → 400 with the exact field message", async () => {
    const svc = new AdminService(makePrisma(), mkAudit());
    await expect(svc.updateSettings(SUPER, { planLimits: { GROWTH: { aiDaily: -1 } } }))
      .rejects.toThrow("planLimits.GROWTH.aiDaily must be a non-negative integer");
  });

  it("(f) non-integer (1.5) → 400", async () => {
    const svc = new AdminService(makePrisma(), mkAudit());
    await expect(svc.updateSettings(SUPER, { planLimits: { FREE: { seats: 1.5 } } }))
      .rejects.toThrow("planLimits.FREE.seats must be a non-negative integer");
  });

  it("(f) non-object planLimits → 400; non-object tier → 400", async () => {
    const svc = new AdminService(makePrisma(), mkAudit());
    await expect(svc.updateSettings(SUPER, { planLimits: "nope" as any })).rejects.toThrow(/planLimits must be an object/);
    await expect(svc.updateSettings(SUPER, { planLimits: { GROWTH: 5 as any } })).rejects.toThrow(/planLimits\.GROWTH must be an object/);
    await expect(svc.updateSettings(SUPER, { planLimits: null as any })).rejects.toThrow(/planLimits must be an object/);
    await expect(svc.updateSettings(SUPER, { planLimits: [] as any })).rejects.toThrow(/planLimits must be an object/);
  });

  it("(g) accepts planLimits (including 0) and getSettings returns merged + stored", async () => {
    const p = makePrisma();
    const svc = new AdminService(p, mkAudit());

    const before: any = await svc.getSettings();
    expect(before.planLimits).toEqual(DEFAULT_PLAN_LIMITS);
    expect(before.planLimitsStored).toBeNull();

    const after: any = await svc.updateSettings(SUPER, {
      planLimits: { GROWTH: { aiDaily: 321, seats: 0 } },
    });
    // Stored is exactly what was written.
    expect(after.planLimitsStored).toEqual({ GROWTH: { aiDaily: 321, seats: 0 } });
    // Merged overlays the stored fields over defaults.
    expect(after.planLimits.GROWTH).toEqual({ aiDaily: 321, broadcastCap: DEFAULT_PLAN_LIMITS.GROWTH.broadcastCap, seats: 0 });
    expect(after.planLimits.FREE).toEqual(DEFAULT_PLAN_LIMITS.FREE);

    // A fresh getSettings agrees.
    const again: any = await svc.getSettings();
    expect(again.planLimits).toEqual(after.planLimits);
    expect(again.planLimitsStored).toEqual({ GROWTH: { aiDaily: 321, seats: 0 } });
  });

  it("publicPricing shows merged limits, not the constant", async () => {
    const p = makePrisma({ settings: { planLimits: { FREE: { aiDaily: 3, broadcastCap: 4, seats: 5 } } } });
    const svc = new AdminService(p, mkAudit());
    const pricing: any = await svc.publicPricing();
    const free = pricing.plans.find((x: any) => x.tier === "FREE");
    expect(free.limits).toEqual({ aiDaily: 3, broadcastCap: 4, seats: 5 });
    const growth = pricing.plans.find((x: any) => x.tier === "GROWTH");
    expect(growth.limits).toEqual(DEFAULT_PLAN_LIMITS.GROWTH);
  });
});

describe("AA4 — dedicated route", () => {
  it("PATCH settings/plan-limits carries @AdminTier(SUPER)", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).updatePlanLimits)).toEqual(["SUPER"]);
  });

  it("SETTING_KEYS includes planLimits", () => {
    expect(AdminService.SETTING_KEYS as readonly string[]).toContain("planLimits");
  });
});
