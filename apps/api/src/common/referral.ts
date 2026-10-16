import { platformSetting } from "./platform-settings";
import { createAgentNotification } from "./agent-notify";

/**
 * Referral program helpers (Milestone 41, Admin Phase A5).
 *
 * Codes are per-user and generated lazily. A referral is recorded
 * at signup when the new user arrives with someone's code. The
 * reward lands ONCE, when the referred user's organization makes
 * its FIRST real payment (online activation or an operator-recorded
 * manual payment): the referrer's own organization receives the
 * configured amount as billing credit. The reward only exists
 * when the operator enabled the program in Admin → Growth.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newReferralCode(): string {
  let body = "";
  for (let i = 0; i < 6; i++) body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `QOS-${body}`;
}

export async function ensureReferralCode(prisma: any, user: any): Promise<string> {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    const clash = await prisma.user.findUnique({ where: { referralCode: code } }).catch(() => null);
    if (clash) continue;
    await prisma.user.update({ where: { id: user.id }, data: { referralCode: code } });
    return code;
  }
  throw new Error("Could not allocate a referral code");
}

export interface ReferralConfig {
  enabled: boolean;
  /** flat = fixed amount · percent = % of the first payment · per_plan = amount by the plan bought. */
  mode: "flat" | "percent" | "per_plan";
  rewardMinor: number;
  percentOfFirstPayment: number;
  perPlanMinor: Record<string, number>;
  /** Welcome credit for the REFERRED org on its first payment (two-sided program). */
  refereeBonusMinor: number;
  /** The first payment must reach this to qualify (0 = any). */
  minFirstPaymentMinor: number;
  /** Days before granted credit expires (0 = never). Enforced by the R2 ledger job. */
  creditExpiryDays: number;
  /** Paid-referral count thresholds with a bonus (R4). */
  milestones: { count: number; bonusMinor: number }[];
}

const nonNeg = (v: unknown, fallback = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function referralConfig(prisma: any): Promise<ReferralConfig> {
  const raw: any = await platformSetting(prisma, "referralConfig").catch(() => null);
  const perPlan: Record<string, number> = {};
  if (raw?.perPlanMinor && typeof raw.perPlanMinor === "object") {
    for (const [k, v] of Object.entries(raw.perPlanMinor)) {
      const n = nonNeg(v);
      if (n > 0) perPlan[String(k).toUpperCase()] = n;
    }
  }
  const milestones = (Array.isArray(raw?.milestones) ? raw.milestones : [])
    .map((m: any) => ({ count: nonNeg(m?.count), bonusMinor: nonNeg(m?.bonusMinor) }))
    .filter((m: any) => m.count > 0 && m.bonusMinor > 0)
    .sort((a: any, b: any) => a.count - b.count);
  return {
    enabled: raw?.enabled === true,
    mode: ["percent", "per_plan"].includes(raw?.mode) ? raw.mode : "flat",
    rewardMinor: Math.max(0, Math.floor(Number(raw?.rewardMinor ?? 50000)) || 0),
    percentOfFirstPayment: Math.min(100, nonNeg(raw?.percentOfFirstPayment)),
    perPlanMinor: perPlan,
    refereeBonusMinor: nonNeg(raw?.refereeBonusMinor),
    minFirstPaymentMinor: nonNeg(raw?.minFirstPaymentMinor),
    creditExpiryDays: Math.min(3650, nonNeg(raw?.creditExpiryDays)),
    milestones,
  };
}

/** The referrer's reward for one qualifying first payment. */
export function computeReferralReward(cfg: ReferralConfig, plan: string | null, amountMinor: number | null): number {
  if (cfg.mode === "percent") {
    if (amountMinor == null || cfg.percentOfFirstPayment <= 0) return 0;
    return Math.floor((amountMinor * cfg.percentOfFirstPayment) / 100);
  }
  if (cfg.mode === "per_plan") {
    const byPlan = plan ? cfg.perPlanMinor[String(plan).toUpperCase()] : undefined;
    return byPlan ?? cfg.rewardMinor; // the flat amount is the documented fallback
  }
  return cfg.rewardMinor;
}

async function creditOrg(prisma: any, orgId: string, delta: bigint) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } }).catch(() => null);
  if (!org) return;
  await prisma.organization.update({
    where: { id: orgId },
    data: { creditMinor: (org.creditMinor != null ? BigInt(org.creditMinor) : 0n) + delta },
  });
}

async function ledger(prisma: any, entry: { organizationId: string; deltaMinor: bigint; reason: string; referralId?: string; expiresAt?: Date | null }) {
  await prisma.creditLedger?.create?.({ data: entry })?.catch?.(() => null);
}

/**
 * Reward the referrer if `organizationId` just made its first
 * payment and its owner was referred. Best-effort by design:
 * failures are swallowed by the caller (a reward must never break
 * a payment) but a successful reward is fully audited.
 *
 * R1: the reward follows the configured mode against the
 * ACTUAL first payment (opts.amountMinor / opts.plan), the
 * referred org can earn a welcome credit too, and a payment
 * below the configured minimum does not qualify (the referral
 * stays pending — nothing is paid, nothing is claimed).
 */
export async function maybeRewardReferral(
  prisma: any,
  audit: { log: (e: any) => Promise<unknown> },
  organizationId: string,
  opts?: { amountMinor?: number | bigint | null; plan?: string | null },
): Promise<{ rewarded: boolean; rewardMinor?: number; refereeBonusMinor?: number; reason?: string; milestonesAwarded?: { count: number; bonusMinor: number }[] }> {
  const cfg = await referralConfig(prisma);
  if (!cfg.enabled) return { rewarded: false, reason: "disabled" };
  const ownerMembership = await prisma.membership.findFirst({
    where: { organizationId, role: "OWNER" },
  }).catch(() => null);
  if (!ownerMembership) return { rewarded: false, reason: "no_owner" };
  const referral = await prisma.referral.findUnique({
    where: { referredUserId: ownerMembership.userId },
  }).catch(() => null);
  if (!referral || referral.status !== "pending") return { rewarded: false, reason: "no_pending_referral" };
  if (referral.referrerUserId && referral.referrerUserId === ownerMembership.userId) return { rewarded: false, reason: "self_referral" };
  // Referral Advanced R4: campaign terms locked at signup
  // override the program config for THIS referral.
  const snap: any = (referral as any).termsSnapshot ?? null;
  const effCfg: ReferralConfig = snap
    ? {
        ...cfg,
        mode: ["percent", "per_plan", "flat"].includes(snap.mode) ? snap.mode : (snap.rewardMinor != null ? "flat" : cfg.mode),
        rewardMinor: snap.rewardMinor != null ? Number(snap.rewardMinor) : cfg.rewardMinor,
        percentOfFirstPayment: snap.percentOfFirstPayment != null ? Number(snap.percentOfFirstPayment) : cfg.percentOfFirstPayment,
        refereeBonusMinor: snap.refereeBonusMinor != null ? Number(snap.refereeBonusMinor) : cfg.refereeBonusMinor,
        minFirstPaymentMinor: snap.minFirstPaymentMinor != null ? Number(snap.minFirstPaymentMinor) : cfg.minFirstPaymentMinor,
      }
    : cfg;
  const amount = opts?.amountMinor != null ? Number(opts.amountMinor) : null;
  if (amount != null && effCfg.minFirstPaymentMinor > 0 && amount < effCfg.minFirstPaymentMinor) {
    return { rewarded: false, reason: "below_minimum" };
  }
  const plan = opts?.plan ?? null;
  const reward = computeReferralReward(effCfg, plan, amount);
  const bonus = effCfg.refereeBonusMinor;
  if (reward <= 0 && bonus <= 0) return { rewarded: false, reason: "zero_reward" };
  const isCampaign = referral.referrerUserId == null;
  let targetOrg: any;
  if (isCampaign) {
    // A campaign has no referrer: the joining org receives
    // the campaign's credit itself (reward + welcome).
    targetOrg = await prisma.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!targetOrg) return { rewarded: false, reason: "org_missing" };
  } else {
    const referrerMembership = await prisma.membership.findFirst({
      where: { userId: referral.referrerUserId, role: "OWNER" },
    }).catch(() => null) ?? await prisma.membership.findFirst({
      where: { userId: referral.referrerUserId },
    }).catch(() => null);
    if (!referrerMembership) return { rewarded: false, reason: "referrer_org_missing" };
    targetOrg = await prisma.organization.findUnique({ where: { id: referrerMembership.organizationId } }).catch(() => null);
    if (!targetOrg) return { rewarded: false, reason: "referrer_org_missing" };
  }
  const expiresAt = cfg.creditExpiryDays > 0 ? new Date(Date.now() + cfg.creditExpiryDays * 86400000) : null;
  if (reward > 0) {
    await creditOrg(prisma, targetOrg.id, BigInt(reward));
    await ledger(prisma, { organizationId: targetOrg.id, deltaMinor: BigInt(reward), reason: "referral_reward", referralId: referral.id, expiresAt });
  }
  if (bonus > 0) {
    await creditOrg(prisma, organizationId, BigInt(bonus));
    await ledger(prisma, { organizationId, deltaMinor: BigInt(bonus), reason: "referral_welcome", referralId: referral.id, expiresAt });
  }
  await prisma.referral.update({
    where: { id: referral.id },
    data: {
      status: "rewarded", rewardMinor: BigInt(reward), refereeBonusMinor: BigInt(bonus),
      firstPaymentMinor: amount != null ? BigInt(Math.floor(amount)) : null,
      rewardedOrgId: targetOrg.id, rewardedAt: new Date(),
    },
  });
  await audit.log({
    userId: referral.referrerUserId,
    organizationId: targetOrg.id,
    action: "referral.rewarded",
    entityType: "Referral",
    entityId: referral.id,
    metadata: {
      rewardMinor: reward, refereeBonusMinor: bonus, mode: cfg.mode,
      firstPaymentMinor: amount, plan, referredOrganizationId: organizationId,
    },
  }).catch(() => undefined);
  // Referral Advanced R3: tell both sides, in-app. (Email
  // is not sent from this engine — it has no provider; the
  // ledger + notification + audit are the record.)
  const tk = (n: number) => `৳${(n / 100).toFixed(2)}`;
  if (reward > 0 && !isCampaign) {
    await createAgentNotification(prisma, {
        organizationId: targetOrg.id, userId: referral.referrerUserId, type: "referral",
        title: "🎁 রেফারেল রিওয়ার্ড পেয়েছেন!",
        body: `আপনার রেফারেলে একটি ব্যবসা প্রথম পেমেন্ট করেছে — ${tk(reward)} বিলিং ক্রেডিট যোগ হয়েছে।`
      })?.catch?.(() => null);
  }
  if (bonus > 0) {
    await createAgentNotification(prisma, {
        organizationId, userId: ownerMembership.userId, type: "referral",
        title: "👋 ওয়েলকাম ক্রেডিট পেয়েছেন!",
        body: `রেফারেল প্রোগ্রামে স্বাগতম — আপনার ওয়ার্কস্পেসে ${tk(bonus)} ওয়েলকাম ক্রেডিট যোগ হয়েছে।`
      })?.catch?.(() => null);
  }
  // Referral Advanced R4: milestone bonuses — when this
  // reward crosses a configured paid-referral threshold,
  // the referrer earns the bonus ONCE per threshold (the
  // award row's unique constraint is the guarantee).
  const milestonesAwarded: { count: number; bonusMinor: number }[] = [];
  if (!isCampaign && referral.referrerUserId && cfg.milestones.length) {
    const rewardedCount = (await prisma.referral?.count?.({
      where: { referrerUserId: referral.referrerUserId, status: "rewarded" },
    })?.catch?.(() => 0)) ?? 0;
    for (const m of cfg.milestones) {
      if (rewardedCount < m.count) continue;
      let created = false;
      try {
        await prisma.referralMilestoneAward.create({
          data: { referrerUserId: referral.referrerUserId, threshold: m.count, bonusMinor: BigInt(m.bonusMinor), orgId: targetOrg.id },
        });
        created = true;
      } catch { /* already awarded */ }
      if (!created) continue;
      await creditOrg(prisma, targetOrg.id, BigInt(m.bonusMinor));
      await ledger(prisma, { organizationId: targetOrg.id, deltaMinor: BigInt(m.bonusMinor), reason: "milestone_bonus" });
      await audit.log({
        userId: referral.referrerUserId, organizationId: targetOrg.id,
        action: "referral.milestone_bonus", entityType: "Referral", entityId: referral.id,
        metadata: { threshold: m.count, bonusMinor: m.bonusMinor, rewardedCount },
      }).catch(() => undefined);
      await createAgentNotification(prisma, {
          organizationId: targetOrg.id, userId: referral.referrerUserId, type: "referral",
          title: "🏆 মাইলস্টোন বোনাস!",
          body: `আপনি ${m.count}টি পেইড রেফারেল পূর্ণ করেছেন — বোনাস ${tk(m.bonusMinor)} ক্রেডিট যোগ হয়েছে।`
        })?.catch?.(() => null);
      milestonesAwarded.push(m);
    }
  }
  return { rewarded: true, rewardMinor: reward, refereeBonusMinor: bonus, milestonesAwarded };
}

/**
 * Referral Advanced R3: when the payment that CAUSED a
 * reward is fully refunded, reverse it — debit the
 * referrer's reward and the referee's welcome credit
 * (never below zero; any shortfall is recorded in the
 * audit), mark the referral clawed_back (terminal), and
 * notify the referrer. Called from the admin refund path;
 * best-effort like the reward itself.
 */
export async function maybeClawbackReferral(
  prisma: any,
  audit: { log: (e: any) => Promise<unknown> },
  payment: { id: string; organizationId: string },
): Promise<{ clawedBack: boolean; debitedMinor?: string; shortfallMinor?: string }> {
  const first = await prisma.saasPayment?.findFirst?.({
    where: { organizationId: payment.organizationId }, orderBy: { createdAt: "asc" },
  })?.catch?.(() => null);
  if (!first || first.id !== payment.id) return { clawedBack: false };
  const owner = await prisma.membership.findFirst({
    where: { organizationId: payment.organizationId, role: "OWNER" },
  }).catch(() => null);
  if (!owner) return { clawedBack: false };
  const referral = await prisma.referral.findUnique({
    where: { referredUserId: owner.userId },
  }).catch(() => null);
  if (!referral || referral.status !== "rewarded") return { clawedBack: false };
  const debit = async (orgId: string | null, amt: bigint): Promise<bigint> => {
    if (!orgId || amt <= 0n) return 0n;
    const org = await prisma.organization.findUnique({ where: { id: orgId } }).catch(() => null);
    if (!org) return amt;
    const bal = org.creditMinor != null ? BigInt(org.creditMinor) : 0n;
    const take = bal > amt ? amt : bal;
    if (take > 0n) {
      await prisma.organization.update({ where: { id: orgId }, data: { creditMinor: bal - take } });
      await ledger(prisma, { organizationId: orgId, deltaMinor: -take, reason: "referral_clawback", referralId: referral.id });
    }
    return amt - take;
  };
  const reward = BigInt(referral.rewardMinor ?? 0);
  const bonus = BigInt(referral.refereeBonusMinor ?? 0);
  const shortfall = (await debit(referral.rewardedOrgId ?? null, reward)) + (await debit(payment.organizationId, bonus));
  const debited = reward + bonus - shortfall;
  await prisma.referral.update({ where: { id: referral.id }, data: { status: "clawed_back" } });
  await audit.log({
    userId: referral.referrerUserId,
    organizationId: referral.rewardedOrgId ?? payment.organizationId,
    action: "referral.clawed_back",
    entityType: "Referral",
    entityId: referral.id,
    metadata: {
      rewardMinor: reward.toString(), refereeBonusMinor: bonus.toString(),
      debitedMinor: debited.toString(), shortfallMinor: shortfall.toString(),
      paymentId: payment.id,
    },
  }).catch(() => undefined);
  if (referral.rewardedOrgId) {
    await createAgentNotification(prisma, {
        organizationId: referral.rewardedOrgId, userId: referral.referrerUserId, type: "referral",
        title: "↩️ রেফারেল রিওয়ার্ড ফেরত নেওয়া হয়েছে",
        body: "রেফার করা ব্যবসাটির প্রথম পেমেন্ট রিফান্ড হওয়ায় সংশ্লিষ্ট রিওয়ার্ড ক্রেডিট ফেরত নেওয়া হয়েছে।"
      })?.catch?.(() => null);
  }
  return { clawedBack: true, debitedMinor: debited.toString(), shortfallMinor: shortfall.toString() };
}
