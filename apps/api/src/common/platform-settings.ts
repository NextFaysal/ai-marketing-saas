/**
 * Platform-level settings + per-org limit overrides, read directly
 * through Prisma with defensive guards: older unit-test fakes (and
 * partially migrated databases) simply yield "no setting", which
 * always means the built-in default applies. Admin writes go
 * through AdminService; these helpers are the read path used by
 * tenant-facing enforcement points (AI cap, broadcast cap, seats,
 * signup gate, kill switches).
 */
export async function platformSetting(prisma: any, key: string): Promise<unknown> {
  try {
    const row = await prisma.systemSetting?.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function killSwitches(prisma: any): Promise<{ aiDisabledOrgIds: string[]; broadcastsPaused: boolean }> {
  const raw = (await platformSetting(prisma, "killSwitches")) as any;
  return {
    aiDisabledOrgIds: Array.isArray(raw?.aiDisabledOrgIds) ? raw.aiDisabledOrgIds.map(String) : [],
    broadcastsPaused: raw?.broadcastsPaused === true,
  };
}

export async function orgLimitOverrides(prisma: any, organizationId: string) {
  try {
    const org = await prisma.organization?.findUnique({
      where: { id: organizationId },
      select: { aiDailyLimitOverride: true, broadcastCapOverride: true, seatLimit: true },
    });
    return {
      aiDailyLimit: org?.aiDailyLimitOverride ?? null,
      broadcastCap: org?.broadcastCapOverride ?? null,
      seatLimit: org?.seatLimit ?? null,
    };
  } catch {
    return { aiDailyLimit: null, broadcastCap: null, seatLimit: null };
  }
}

/** SaaS plan tiers (Milestone 27). Prices are operator-editable
 * starting values stored in SystemSetting "planPrices" — they are
 * configuration, never market claims. */
// Tier names mirror the SubscriptionPlan enum in the Prisma schema.
export const PLAN_TIERS = ["FREE", "STARTER", "GROWTH", "AGENCY"] as const;
export const DEFAULT_PLAN_PRICES_MINOR: Record<string, number> = { FREE: 0, STARTER: 150000, GROWTH: 300000, AGENCY: 800000 };
export const DEFAULT_PLAN_LIMITS: Record<string, { aiDaily: number; broadcastCap: number; seats: number }> = {
  FREE: { aiDaily: 20, broadcastCap: 200, seats: 2 },
  STARTER: { aiDaily: 50, broadcastCap: 500, seats: 5 },
  GROWTH: { aiDaily: 200, broadcastCap: 1000, seats: 10 },
  AGENCY: { aiDaily: 1000, broadcastCap: 5000, seats: 50 },
};

export async function planPrices(prisma: any): Promise<Record<string, number>> {
  const raw = (await platformSetting(prisma, "planPrices")) as any;
  const out = { ...DEFAULT_PLAN_PRICES_MINOR };
  for (const tier of PLAN_TIERS) if (typeof raw?.[tier] === "number" && raw[tier] >= 0) out[tier] = raw[tier];
  return out;
}

export type PlanLimits = {
  aiDaily: number; broadcastCap: number; seats: number;
  // GC22 (GB9): resource limits — OPTIONAL per tier. Absent
  // (in defaults AND in stored config) = unlimited; a stored
  // integer >= 0 is a real cap (0 blocks everything).
  productLimit?: number; orderLimit?: number; storageLimitMb?: number; apiDailyLimit?: number;
};
export const PLAN_LIMIT_FIELDS = ["aiDaily", "broadcastCap", "seats", "productLimit", "orderLimit", "storageLimitMb", "apiDailyLimit"] as const;

/** AA4: operator-editable per-plan limits stored in SystemSetting
 * "planLimits". Mirrors planPrices(): start from a deep copy of
 * DEFAULT_PLAN_LIMITS and overlay only integer >= 0 values, so
 * 0 is a real blocking value and partial tiers/fields merge. */
export async function planLimits(prisma: any): Promise<Record<string, PlanLimits>> {
  const raw = (await platformSetting(prisma, "planLimits")) as any;
  const out: Record<string, PlanLimits> = {};
  for (const tier of PLAN_TIERS) out[tier] = { ...DEFAULT_PLAN_LIMITS[tier] };
  if (raw && typeof raw === "object") {
    for (const tier of PLAN_TIERS) {
      const tierRaw = raw[tier];
      if (!tierRaw || typeof tierRaw !== "object") continue;
      for (const field of PLAN_LIMIT_FIELDS) {
        const v = tierRaw[field];
        if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[tier][field] = v;
      }
    }
  }
  return out;
}

/** GC22 (GB9): the org's plan resource limits, resolved from
 * its current tier. Each limit is a number when the tier's
 * merged planLimits carry the field, or null = unlimited. */
export async function planResourceLimits(
  prisma: any,
  organizationId: string,
): Promise<{ plan: string; productLimit: number | null; orderLimit: number | null; storageLimitMb: number | null; apiDailyLimit: number | null }> {
  const [plan, allLimits] = await Promise.all([orgPlan(prisma, organizationId), planLimits(prisma)]);
  const tier = allLimits[plan] ?? allLimits.FREE;
  const pick = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    plan,
    productLimit: pick(tier?.productLimit),
    orderLimit: pick(tier?.orderLimit),
    storageLimitMb: pick(tier?.storageLimitMb),
    apiDailyLimit: pick(tier?.apiDailyLimit),
  };
}

/** GC22 (GB9): days a PAST_DUE org may keep trading after its
 * period ends before commerce writes refuse. Operator-set via
 * SystemSetting "billingGraceDays" (integer >= 0 wins);
 * default 3. */
export async function billingGraceDays(prisma: any): Promise<number> {
  const raw = await platformSetting(prisma, "billingGraceDays");
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 3;
}

/** Billing Package B3: yearly cycle prices. Defaults are
 * the monthly price × 10 ("two months free") — operator
 * configuration like the monthly prices, stored in
 * SystemSetting "planYearlyPrices". */
export const DEFAULT_PLAN_YEARLY_PRICES_MINOR: Record<string, number> = { FREE: 0, STARTER: 1500000, GROWTH: 3000000, AGENCY: 8000000 };

export async function planYearlyPrices(prisma: any): Promise<Record<string, number>> {
  const raw = (await platformSetting(prisma, "planYearlyPrices")) as any;
  const out = { ...DEFAULT_PLAN_YEARLY_PRICES_MINOR };
  for (const tier of PLAN_TIERS) if (typeof raw?.[tier] === "number" && raw[tier] >= 0) out[tier] = raw[tier];
  return out;
}

/** Period length per billing cycle, in days. */
export function cycleDays(cycle: unknown): number {
  return cycle === "yearly" ? 365 : 30;
}

export async function orgPlan(prisma: any, organizationId: string): Promise<string> {
  try {
    const sub = await prisma.subscription?.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    return sub?.plan && (PLAN_TIERS as readonly string[]).includes(sub.plan) ? sub.plan : "FREE";
  } catch {
    return "FREE";
  }
}

/** Effective limits for an org: admin override beats plan, plan
 * beats the deployment-wide env/default baseline. */
export async function effectiveLimits(
  prisma: any,
  organizationId: string,
  baseline: { aiDaily: number; broadcastCap: number },
): Promise<{ aiDaily: number; broadcastCap: number; seats: number | null; plan: string }> {
  const [overrides, plan, allLimits] = await Promise.all([
    orgLimitOverrides(prisma, organizationId),
    orgPlan(prisma, organizationId),
    planLimits(prisma),
  ]);
  const limitsForPlan = allLimits[plan] ?? allLimits.FREE ?? DEFAULT_PLAN_LIMITS.FREE;
  return {
    aiDaily: overrides.aiDailyLimit ?? limitsForPlan.aiDaily ?? baseline.aiDaily,
    broadcastCap: overrides.broadcastCap ?? limitsForPlan.broadcastCap ?? baseline.broadcastCap,
    seats: overrides.seatLimit ?? limitsForPlan.seats ?? null,
    plan,
  };
}

/** Subscription sweep (Milestone 27): an org whose paid/trial period
 * has ended without renewal becomes PAST_DUE. Nothing is suspended
 * automatically — suspension stays a human admin decision. */
export async function sweepSubscription(prisma: any, organizationId: string): Promise<{ changed: boolean; status?: string }> {
  try {
    const sub = await prisma.subscription?.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    if (!sub?.currentPeriodEnd) return { changed: false };
    if (!["TRIALING", "ACTIVE"].includes(sub.status)) return { changed: false };
    if (new Date(sub.currentPeriodEnd) > new Date()) return { changed: false };
    // Billing Package B2: a scheduled plan change lands
    // FIRST. FREE means the cancellation takes effect —
    // the org drops to the free plan, active, no period.
    // A paid target becomes the plan now owed: the period
    // still closes unpaid (PAST_DUE) at the lower price.
    if (sub.pendingPlan) {
      const target = String(sub.pendingPlan);
      if (target === "FREE") {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { plan: "FREE", status: "ACTIVE", currentPeriodEnd: null, pendingPlan: null, pendingPlanAt: null },
        });
        return { changed: true, status: "FREE" };
      }
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { plan: target, status: "PAST_DUE", pendingPlan: null, pendingPlanAt: null },
      });
      return { changed: true, status: "PAST_DUE" };
    }
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
    return { changed: true, status: "PAST_DUE" };
  } catch {
    return { changed: false };
  }
}
