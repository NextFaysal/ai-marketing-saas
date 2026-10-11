import { maybeRewardReferral, referralConfig, computeReferralReward } from "./referral";

/**
 * Referral Advanced R1: the reward follows the configured
 * mode against the ACTUAL first payment, a too-small first
 * payment does not qualify, the referee can earn a welcome
 * credit, and every credit lands in the ledger with its
 * expiry.
 */
function world(cfgValue: any, opts: { payment?: number; plan?: string } = {}) {
  const ledger: any[] = [];
  const orgs: Record<string, any> = {
    "org-ref": { id: "org-ref", creditMinor: 0n },
    "org-new": { id: "org-new", creditMinor: 0n },
  };
  const referral: any = { id: "ref-1", referrerUserId: "u-ref", referredUserId: "u-new", code: "QOS-ABC123", status: "pending" };
  const fake: any = {
    systemSetting: { findUnique: async ({ where }: any) => (where.key === "referralConfig" ? { key: "referralConfig", value: cfgValue } : null) },
    membership: {
      findFirst: async ({ where }: any) => {
        if (where.organizationId === "org-new" && where.role === "OWNER") return { userId: "u-new", organizationId: "org-new", role: "OWNER" };
        if (where.userId === "u-ref") return { userId: "u-ref", organizationId: "org-ref", role: "OWNER" };
        return null;
      },
    },
    referral: {
      findUnique: async ({ where }: any) => (where.referredUserId === "u-new" ? referral : null),
      update: async ({ data }: any) => { Object.assign(referral, data); return referral; },
    },
    organization: {
      findUnique: async ({ where }: any) => orgs[where.id] ?? null,
      update: async ({ where, data }: any) => { Object.assign(orgs[where.id], data); return orgs[where.id]; },
    },
    creditLedger: { create: async ({ data }: any) => { ledger.push(data); return data; } },
  };
  const audits: any[] = [];
  return { fake, orgs, referral, ledger, audits, audit: { log: async (e: any) => { audits.push(e); } } };
}

describe("R1 smart referral engine", () => {
  it("flat parity: the M41 flat reward still lands, now with a ledger entry", async () => {
    const w = world({ enabled: true, rewardMinor: 50000 });
    const out = await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 150000, plan: "STARTER" });
    expect(out).toMatchObject({ rewarded: true, rewardMinor: 50000 });
    expect(w.orgs["org-ref"].creditMinor).toBe(50000n);
    expect(w.ledger).toEqual([expect.objectContaining({ reason: "referral_reward", deltaMinor: 50000n, expiresAt: null })]);
    expect(w.referral.status).toBe("rewarded");
    expect(w.referral.firstPaymentMinor).toBe(150000n);
  });

  it("percent mode pays a share of the actual first payment", async () => {
    const w = world({ enabled: true, mode: "percent", percentOfFirstPayment: 20, rewardMinor: 50000 });
    const out = await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 300000, plan: "GROWTH" });
    expect(out.rewardMinor).toBe(60000);
    expect(w.orgs["org-ref"].creditMinor).toBe(60000n);
  });

  it("per_plan mode prices by the bought plan, flat is the fallback", async () => {
    const cfg = { enabled: true, mode: "per_plan" as const, rewardMinor: 50000, perPlanMinor: { GROWTH: 80000 }, percentOfFirstPayment: 0, refereeBonusMinor: 0, minFirstPaymentMinor: 0, creditExpiryDays: 0, milestones: [] };
    expect(computeReferralReward(cfg as any, "GROWTH", 300000)).toBe(80000);
    expect(computeReferralReward(cfg as any, "STARTER", 150000)).toBe(50000);
  });

  it("below the minimum first payment: no reward, referral stays pending", async () => {
    const w = world({ enabled: true, rewardMinor: 50000, minFirstPaymentMinor: 100000 });
    const out = await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 50000, plan: "STARTER" });
    expect(out).toMatchObject({ rewarded: false, reason: "below_minimum" });
    expect(w.referral.status).toBe("pending");
    expect(w.orgs["org-ref"].creditMinor).toBe(0n);
    expect(w.ledger).toHaveLength(0);
  });

  it("two-sided: the referee earns the welcome credit; grants carry the expiry", async () => {
    const w = world({ enabled: true, rewardMinor: 50000, refereeBonusMinor: 10000, creditExpiryDays: 90 });
    const out = await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 150000, plan: "STARTER" });
    expect(out.refereeBonusMinor).toBe(10000);
    expect(w.orgs["org-new"].creditMinor).toBe(10000n);
    const welcome = w.ledger.find((l) => l.reason === "referral_welcome");
    expect(welcome.deltaMinor).toBe(10000n);
    expect(welcome.expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * 86400000);
    expect(w.referral.refereeBonusMinor).toBe(10000n);
  });

  it("config parsing keeps M41 rows working (flat default, 50000 default)", async () => {
    const w = world({ enabled: true });
    const cfg = await referralConfig(w.fake);
    expect(cfg.mode).toBe("flat");
    expect(cfg.rewardMinor).toBe(50000);
    expect(cfg.milestones).toEqual([]);
  });
});
