import { maybeRewardReferral } from "./referral";

/**
 * Referral Advanced R4: campaign referrals pay the
 * JOINING org on the terms locked at signup (snapshot),
 * and milestone bonuses land exactly once per threshold.
 */
function baseFake(referral: any, cfgValue: any, awards: any[]) {
  const ledger: any[] = [];
  const orgs: Record<string, any> = {
    "org-ref": { id: "org-ref", creditMinor: 0n },
    "org-new": { id: "org-new", creditMinor: 0n },
  };
  const fake: any = {
    systemSetting: { findUnique: async () => ({ key: "referralConfig", value: cfgValue }) },
    membership: {
      findFirst: async ({ where }: any) => {
        if (where.organizationId === "org-new" && where.role === "OWNER") return { userId: "u-new", organizationId: "org-new", role: "OWNER" };
        if (where.userId === "u-ref") return { userId: "u-ref", organizationId: "org-ref", role: "OWNER" };
        return null;
      },
    },
    referral: {
      findUnique: async () => referral,
      update: async ({ data }: any) => { Object.assign(referral, data); return referral; },
      count: async () => fake.__rewardedCount ?? 1,
    },
    organization: {
      findUnique: async ({ where }: any) => orgs[where.id] ?? null,
      update: async ({ where, data }: any) => { Object.assign(orgs[where.id], data); return orgs[where.id]; },
    },
    creditLedger: { create: async ({ data }: any) => { ledger.push(data); return data; } },
    agentNotification: { create: async ({ data }: any) => data },
    referralMilestoneAward: {
      create: async ({ data }: any) => {
        if (awards.some((a) => a.referrerUserId === data.referrerUserId && a.threshold === data.threshold)) {
          throw new Error("unique violation");
        }
        awards.push(data); return data;
      },
    },
  };
  return { fake, orgs, ledger };
}

describe("R4 campaigns + milestones", () => {
  it("a campaign referral pays the joining org on its SNAPSHOT terms, ignoring later program config", async () => {
    const referral: any = {
      id: "ref-c", referrerUserId: null, referredUserId: "u-new", code: "EID2026", status: "pending",
      sourceKind: "campaign",
      termsSnapshot: { mode: "flat", rewardMinor: 20000, refereeBonusMinor: 5000 },
    };
    const { fake, orgs } = baseFake(referral, { enabled: true, rewardMinor: 99900 }, []);
    const out = await maybeRewardReferral(fake, { log: async () => undefined }, "org-new", { amountMinor: 150000, plan: "STARTER" });
    expect(out.rewarded).toBe(true);
    expect(orgs["org-new"].creditMinor).toBe(25000n); // 20000 campaign reward + 5000 welcome, all to the joiner
    expect(orgs["org-ref"].creditMinor).toBe(0n);
    expect(referral.rewardedOrgId).toBe("org-new");
  });

  it("crossing a milestone pays the bonus once — a second reward does not re-pay it", async () => {
    const awards: any[] = [];
    const cfg = { enabled: true, rewardMinor: 10000, milestones: [{ count: 2, bonusMinor: 30000 }] };
    const referral: any = { id: "ref-u", referrerUserId: "u-ref", referredUserId: "u-new", code: "QOS-XYZ", status: "pending", sourceKind: "user" };
    const w = baseFake(referral, cfg, awards);
    w.fake.__rewardedCount = 2; // this reward is the 2nd paid referral
    const out: any = await maybeRewardReferral(w.fake, { log: async () => undefined }, "org-new", { amountMinor: 150000, plan: "STARTER" });
    expect(out.milestonesAwarded).toEqual([{ count: 2, bonusMinor: 30000 }]);
    expect(w.orgs["org-ref"].creditMinor).toBe(40000n); // 10000 reward + 30000 bonus
    expect(w.ledger.some((l: any) => l.reason === "milestone_bonus" && l.deltaMinor === 30000n)).toBe(true);

    // A later reward (3rd) must not pay the threshold-2 bonus again.
    referral.status = "pending";
    w.fake.__rewardedCount = 3;
    const out2: any = await maybeRewardReferral(w.fake, { log: async () => undefined }, "org-new", { amountMinor: 150000, plan: "STARTER" });
    expect(out2.milestonesAwarded).toEqual([]);
    expect(awards).toHaveLength(1);
  });
});
