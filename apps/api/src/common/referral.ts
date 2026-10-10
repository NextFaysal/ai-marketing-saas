import { platformSetting } from "./platform-settings";

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

export async function referralConfig(prisma: any): Promise<{ enabled: boolean; rewardMinor: number }> {
  const raw: any = await platformSetting(prisma, "referralConfig").catch(() => null);
  return {
    enabled: raw?.enabled === true,
    rewardMinor: Math.max(0, Math.floor(Number(raw?.rewardMinor ?? 50000)) || 0),
  };
}

/**
 * Reward the referrer if `organizationId` just made its first
 * payment and its owner was referred. Best-effort by design:
 * failures are swallowed by the caller (a reward must never break
 * a payment) but a successful reward is fully audited.
 */
export async function maybeRewardReferral(prisma: any, audit: { log: (e: any) => Promise<unknown> }, organizationId: string): Promise<{ rewarded: boolean; rewardMinor?: number }> {
  const cfg = await referralConfig(prisma);
  if (!cfg.enabled || cfg.rewardMinor <= 0) return { rewarded: false };
  const ownerMembership = await prisma.membership.findFirst({
    where: { organizationId, role: "OWNER" },
  }).catch(() => null);
  if (!ownerMembership) return { rewarded: false };
  const referral = await prisma.referral.findUnique({
    where: { referredUserId: ownerMembership.userId },
  }).catch(() => null);
  if (!referral || referral.status !== "pending") return { rewarded: false };
  if (referral.referrerUserId === ownerMembership.userId) return { rewarded: false };
  const referrerMembership = await prisma.membership.findFirst({
    where: { userId: referral.referrerUserId, role: "OWNER" },
  }).catch(() => null) ?? await prisma.membership.findFirst({
    where: { userId: referral.referrerUserId },
  }).catch(() => null);
  if (!referrerMembership) return { rewarded: false };
  const targetOrg = await prisma.organization.findUnique({ where: { id: referrerMembership.organizationId } }).catch(() => null);
  if (!targetOrg) return { rewarded: false };
  const reward = BigInt(cfg.rewardMinor);
  await prisma.organization.update({
    where: { id: targetOrg.id },
    data: { creditMinor: (targetOrg.creditMinor != null ? BigInt(targetOrg.creditMinor) : 0n) + reward },
  });
  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "rewarded", rewardMinor: reward, rewardedOrgId: targetOrg.id, rewardedAt: new Date() },
  });
  await audit.log({
    userId: referral.referrerUserId,
    organizationId: targetOrg.id,
    action: "referral.rewarded",
    entityType: "Referral",
    entityId: referral.id,
    metadata: { rewardMinor: cfg.rewardMinor, referredOrganizationId: organizationId },
  }).catch(() => undefined);
  return { rewarded: true, rewardMinor: cfg.rewardMinor };
}
