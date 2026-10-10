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
  const [overrides, plan] = await Promise.all([orgLimitOverrides(prisma, organizationId), orgPlan(prisma, organizationId)]);
  const planLimits = DEFAULT_PLAN_LIMITS[plan] ?? DEFAULT_PLAN_LIMITS.FREE;
  return {
    aiDaily: overrides.aiDailyLimit ?? planLimits.aiDaily ?? baseline.aiDaily,
    broadcastCap: overrides.broadcastCap ?? planLimits.broadcastCap ?? baseline.broadcastCap,
    seats: overrides.seatLimit ?? planLimits.seats ?? null,
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
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
    return { changed: true, status: "PAST_DUE" };
  } catch {
    return { changed: false };
  }
}
