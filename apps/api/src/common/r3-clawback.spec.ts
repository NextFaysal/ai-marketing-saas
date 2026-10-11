import { maybeRewardReferral, maybeClawbackReferral } from "./referral";

/**
 * Referral Advanced R3: a full refund of the payment that
 * caused a reward reverses BOTH credits (never below
 * zero — the shortfall is audited), the referral becomes
 * clawed_back (terminal), and both sides were notified
 * when the reward landed.
 */
function world(refOrgCredit: bigint, newOrgCredit: bigint) {
  const ledger: any[] = [];
  const notifications: any[] = [];
  const orgs: Record<string, any> = {
    "org-ref": { id: "org-ref", creditMinor: refOrgCredit },
    "org-new": { id: "org-new", creditMinor: newOrgCredit },
  };
  const referral: any = {
    id: "ref-1", referrerUserId: "u-ref", referredUserId: "u-new", code: "QOS-ABC123",
    status: "pending", rewardMinor: null, refereeBonusMinor: null, rewardedOrgId: null,
  };
  const fake: any = {
    systemSetting: { findUnique: async () => ({ key: "referralConfig", value: { enabled: true, rewardMinor: 50000, refereeBonusMinor: 10000 } }) },
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
    },
    organization: {
      findUnique: async ({ where }: any) => orgs[where.id] ?? null,
      update: async ({ where, data }: any) => { Object.assign(orgs[where.id], data); return orgs[where.id]; },
    },
    creditLedger: { create: async ({ data }: any) => { ledger.push(data); return data; } },
    agentNotification: { create: async ({ data }: any) => { notifications.push(data); return data; } },
    saasPayment: { findFirst: async () => ({ id: "pay-1", organizationId: "org-new" }) },
  };
  const audits: any[] = [];
  return { fake, orgs, referral, ledger, notifications, audits, audit: { log: async (e: any) => { audits.push(e); } } };
}

describe("R3 clawback + notifications", () => {
  it("reward notifies both sides; a full refund of the first payment reverses both credits", async () => {
    const w = world(0n, 0n);
    await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 150000, plan: "STARTER" });
    expect(w.orgs["org-ref"].creditMinor).toBe(50000n);
    expect(w.orgs["org-new"].creditMinor).toBe(10000n);
    expect(w.notifications.map((n) => n.title)).toEqual(
      expect.arrayContaining([expect.stringContaining("রিওয়ার্ড পেয়েছেন"), expect.stringContaining("ওয়েলকাম")]),
    );
    const out = await maybeClawbackReferral(w.fake, w.audit, { id: "pay-1", organizationId: "org-new" });
    expect(out).toMatchObject({ clawedBack: true, debitedMinor: "60000", shortfallMinor: "0" });
    expect(w.orgs["org-ref"].creditMinor).toBe(0n);
    expect(w.orgs["org-new"].creditMinor).toBe(0n);
    expect(w.referral.status).toBe("clawed_back");
    expect(w.ledger.filter((l) => l.reason === "referral_clawback")).toHaveLength(2);
    // Terminal: a second clawback attempt does nothing.
    const again = await maybeClawbackReferral(w.fake, w.audit, { id: "pay-1", organizationId: "org-new" });
    expect(again.clawedBack).toBe(false);
  });

  it("spent credit floors at zero and the shortfall is audited, never negative", async () => {
    const w = world(0n, 0n);
    await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 150000, plan: "STARTER" });
    w.orgs["org-ref"].creditMinor = 20000n; // the referrer already spent 300 of the 500
    const out = await maybeClawbackReferral(w.fake, w.audit, { id: "pay-1", organizationId: "org-new" });
    expect(out).toMatchObject({ clawedBack: true, debitedMinor: "30000", shortfallMinor: "30000" });
    expect(w.orgs["org-ref"].creditMinor).toBe(0n);
    const audit = w.audits.find((a) => a.action === "referral.clawed_back");
    expect(audit.metadata.shortfallMinor).toBe("30000");
  });

  it("a refund of a NON-first payment never claws back", async () => {
    const w = world(0n, 0n);
    await maybeRewardReferral(w.fake, w.audit, "org-new", { amountMinor: 150000, plan: "STARTER" });
    const out = await maybeClawbackReferral(w.fake, w.audit, { id: "pay-2", organizationId: "org-new" });
    expect(out.clawedBack).toBe(false);
    expect(w.orgs["org-ref"].creditMinor).toBe(50000n);
  });
});
