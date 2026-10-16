import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compareSync, hashSync } from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { createAgentNotification } from "../common/agent-notify";
import { AuditService } from "../audit/audit.service";
import { RegisterDto, LoginDto } from "./auth.dto";
import { VerificationService, readEmailVerificationGate, verificationRequiredFor } from "./verification.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    // GC21 (GB9): registration fires the verification email
    // through this (optional so older direct constructions in
    // specs keep working; absent = no email is attempted).
    @Optional() private readonly verification?: VerificationService,
  ) {}

  /** GB6 (GC16): one LoginEvent row per completed/failed login
   * attempt. Failure-isolated by design — recording must NEVER
   * block or break authentication. The attempted email is
   * stored; passwords and tokens are never stored. */
  private async recordLoginEvent(e: { userId: string | null; email: string; success: boolean; ip?: string; userAgent?: string; method?: string }) {
    try {
      await (this.prisma as any).loginEvent?.create?.({
        data: {
          userId: e.userId ?? null,
          email: e.email,
          success: e.success,
          // AB8 (AX26): "password" (default) | "google" — a TOTP
          // completion records the ORIGINATING method (the
          // challenge token's `via` claim), never "totp".
          method: e.method ?? "password",
          ip: e.ip ?? null,
          userAgent: e.userAgent ? String(e.userAgent).slice(0, 200) : null,
        },
      });
    } catch { /* a login-event failure never blocks auth */ }
  }

  async register(dto: RegisterDto, ip?: string, userAgent?: string) {
    const { platformSetting } = await import("../common/platform-settings");
    if ((await platformSetting(this.prisma as any, "signupOpen")) === false) {
      throw new ForbiddenException("New signups are currently closed by the platform team. Please try again later.");
    }
    const email = dto.email.toLowerCase().trim();
    const existing = await (this.prisma as any).user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("An account with this email already exists");
    const user = await (this.prisma as any).user.create({
      data: { email, name: dto.name.trim(), passwordHash: hashSync(dto.password, 10) },
    });
    await this.audit.log({ userId: user.id, action: "auth.register", entityType: "User", entityId: user.id, ipAddress: ip });
    // GC21 (GB9): send the email-verification link, fire-and-
    // forget — a mail failure NEVER blocks registration (same
    // isolation as the referral block below).
    try {
      void this.verification?.requestEmailVerification(user.id)?.catch?.(() => undefined);
    } catch { /* verification email is best-effort at signup */ }
    // Milestone 41: record the referral when the signup carried a
    // valid code. A bad/unknown code never blocks registration.
    if (dto.referralCode) {
      try {
        const code = dto.referralCode.trim().toUpperCase();
        // Referral Advanced R4: campaign codes are checked
        // FIRST. A live campaign (active, unexpired, under
        // its use cap) records a campaign referral with its
        // terms locked into a snapshot; anything else falls
        // through to the user-code path below.
        const campaign = await (this.prisma as any).referralCampaign?.findUnique?.({ where: { code } })?.catch?.(() => null);
        const nowMs = Date.now();
        if (
          campaign && campaign.active &&
          (!campaign.expiresAt || new Date(campaign.expiresAt).getTime() > nowMs) &&
          (campaign.maxUses == null || campaign.usedCount < campaign.maxUses)
        ) {
          await (this.prisma as any).referral.create({
            data: {
              referrerUserId: null, referredUserId: user.id, code, sourceKind: "campaign",
              termsSnapshot: {
                // A campaign that names a flat amount but no
                // mode MEANS flat — otherwise its rewardMinor
                // would silently vanish under a percent
                // program (live-caught in the R4 proof).
                mode: campaign.mode ?? (campaign.rewardMinor != null ? "flat" : undefined),
                rewardMinor: campaign.rewardMinor != null ? Number(campaign.rewardMinor) : undefined,
                percentOfFirstPayment: campaign.percentOfFirstPayment ?? undefined,
                refereeBonusMinor: campaign.refereeBonusMinor != null ? Number(campaign.refereeBonusMinor) : undefined,
                minFirstPaymentMinor: campaign.minFirstPaymentMinor != null ? Number(campaign.minFirstPaymentMinor) : undefined,
              },
            },
          });
          await (this.prisma as any).referralCampaign.update({
            where: { id: campaign.id }, data: { usedCount: campaign.usedCount + 1 },
          }).catch(() => undefined);
          return this.issueToken(user, { ip, userAgent });
        }
        const referrer = await (this.prisma as any).user.findUnique({ where: { referralCode: code } });
        if (referrer && referrer.id !== user.id) {
          await (this.prisma as any).referral.create({
            data: { referrerUserId: referrer.id, referredUserId: user.id, code: dto.referralCode.trim().toUpperCase() },
          });
          // Referral Advanced R3: tell the referrer someone
          // signed up with their link (in-app, failure-safe).
          const home = await (this.prisma as any).membership?.findFirst?.({
            where: { userId: referrer.id, role: "OWNER" },
          })?.catch?.(() => null) ?? await (this.prisma as any).membership?.findFirst?.({
            where: { userId: referrer.id },
          })?.catch?.(() => null);
          if (home) {
            await createAgentNotification(this.prisma as any, {
                organizationId: home.organizationId, userId: referrer.id, type: "referral",
                title: "🎉 নতুন রেফারেল সাইন আপ",
                body: `${dto.name.trim()} আপনার রেফারেল লিংক দিয়ে সাইন আপ করেছেন। তিনি প্রথম পেমেন্ট করলেই আপনি রিওয়ার্ড পাবেন।`,
              })?.catch?.(() => null);
          }
        }
      } catch { /* duplicate or unavailable — signup stands */ }
    }
    return this.issueToken(user, { ip, userAgent });
  }

  /** Milestone 41: the caller's referral code, link and stats. */
  async myReferral(userId: string) {
    const { ensureReferralCode } = await import("../common/referral");
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    const code = await ensureReferralCode(this.prisma as any, user);
    const rows = await (this.prisma as any).referral?.findMany({
      where: { referrerUserId: userId }, orderBy: { createdAt: "desc" }, take: 50,
    }).catch(() => []) ?? [];
    const referredUsers = await (this.prisma as any).user.findMany({
      where: { id: { in: (rows as any[]).map((r) => r.referredUserId) } },
    }).catch(() => []);
    const byId = new Map((referredUsers as any[]).map((u) => [u.id, u]));
    // Referral Advanced R2: show the referee's business +
    // current plan, so the referrer sees real progress, not
    // just an email address.
    const ownerMemberships = await (this.prisma as any).membership?.findMany?.({
      where: { userId: { in: (rows as any[]).map((r) => r.referredUserId) }, role: "OWNER" },
    })?.catch?.(() => []) ?? [];
    const orgByUser = new Map<string, string>((ownerMemberships as any[]).map((m) => [m.userId, m.organizationId]));
    const orgIds = [...new Set((ownerMemberships as any[]).map((m) => m.organizationId))];
    const orgs = orgIds.length ? await (this.prisma as any).organization?.findMany?.({ where: { id: { in: orgIds } } })?.catch?.(() => []) ?? [] : [];
    const orgNameById = new Map((orgs as any[]).map((o) => [o.id, o.name]));
    const subs = orgIds.length ? await (this.prisma as any).subscription?.findMany?.({
      where: { organizationId: { in: orgIds } }, orderBy: { createdAt: "desc" },
    })?.catch?.(() => []) ?? [] : [];
    const planByOrg = new Map<string, string>();
    for (const s of subs as any[]) if (!planByOrg.has(s.organizationId)) planByOrg.set(s.organizationId, s.plan);
    let earned = 0;
    const referrals = (rows as any[]).map((r) => {
      if (r.status === "rewarded") earned += Number(r.rewardMinor ?? 0);
      const u = byId.get(r.referredUserId);
      const orgId = orgByUser.get(r.referredUserId);
      return {
        id: r.id, status: r.status, createdAt: r.createdAt, rewardedAt: r.rewardedAt,
        rewardMinor: r.rewardMinor != null ? Number(r.rewardMinor) : null,
        refereeBonusMinor: r.refereeBonusMinor != null ? Number(r.refereeBonusMinor) : null,
        sourceKind: r.sourceKind ?? "user",
        referredName: u?.name ?? null, referredEmail: u?.email ?? null,
        referredOrgName: orgId ? (orgNameById.get(orgId) ?? null) : null,
        referredPlan: orgId ? (planByOrg.get(orgId) ?? null) : null,
      };
    });
    const { referralConfig } = await import("../common/referral");
    const cfg = await referralConfig(this.prisma as any);
    const rewardedCount = referrals.filter((r) => r.status === "rewarded").length;
    return {
      code,
      programEnabled: cfg.enabled,
      rewardMinor: cfg.rewardMinor,
      // Referral Advanced R2: the full program terms, so the
      // Referral Center can explain exactly how rewards work.
      config: {
        mode: cfg.mode, percentOfFirstPayment: cfg.percentOfFirstPayment,
        perPlanMinor: cfg.perPlanMinor, refereeBonusMinor: cfg.refereeBonusMinor,
        minFirstPaymentMinor: cfg.minFirstPaymentMinor, creditExpiryDays: cfg.creditExpiryDays,
        milestones: cfg.milestones,
      },
      stats: {
        signups: referrals.length,
        rewarded: rewardedCount,
        pending: referrals.filter((r) => r.status === "pending").length,
        earnedMinor: earned,
        conversionPercent: referrals.length ? Math.round((rewardedCount / referrals.length) * 1000) / 10 : null,
      },
      referrals,
    };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim();
    const user = await (this.prisma as any).user.findUnique({ where: { email } });
    if (!user || user.status === "DELETED" || !compareSync(dto.password, user.passwordHash)) {
      // Milestone 40: failed logins are audit-logged (email only,
      // never the password) so the admin Security page can flag
      // brute-force patterns. Same error either way — no oracle.
      await this.audit.log({
        userId: user?.id, action: "auth.login_failed", entityType: "User", entityId: user?.id,
        metadata: { email }, ipAddress: ip,
      }).catch(() => undefined);
      // GB6 (GC16): the same failure lands in the per-user login
      // history (userId null for unknown emails).
      await this.recordLoginEvent({ userId: user?.id ?? null, email, success: false, ip, userAgent });
      throw new UnauthorizedException("Invalid email or password");
    }
    if (user.status === "SUSPENDED") {
      throw new UnauthorizedException("This account has been suspended by the platform team. Please contact support.");
    }
    if (user.totpEnabled && user.totpSecretEncrypted) {
      // Password verified; a TOTP challenge must complete before any
      // token is issued. The challenge is a short-lived signed token
      // bound to the user's current token version.
      const { issueAdminToken } = await import("../common/admin-token");
      return {
        requiresTotp: true,
        challengeToken: issueAdminToken({ purpose: "totp-challenge", sub: user.id, tv: user.tokenVersion ?? 0 }, 5),
        user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin, totpEnabled: true },
      };
    }
    await (this.prisma as any).user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    await this.audit.log({ userId: user.id, action: user.isSuperAdmin ? "admin.login" : "auth.login", entityType: "User", entityId: user.id, ipAddress: ip });
    // GB6 (GC16): a completed login. (A TOTP-pending response
    // above is NOT a completed login and records nothing.)
    await this.recordLoginEvent({ userId: user.id, email: user.email, success: true, ip, userAgent });
    return this.issueToken(user, { ip, userAgent });
  }

  /** Consume an admin-issued password reset token. Using it bumps
   * the token version, which revokes every existing session. */
  async resetPasswordWithAdminToken(token: string, newPassword: string) {
    const { verifyAdminToken } = await import("../common/admin-token");
    const body = verifyAdminToken(token, "pwd-reset");
    if (!body) throw new UnauthorizedException("This reset link is invalid or has expired");
    const user = await (this.prisma as any).user.findUnique({ where: { id: body.sub } });
    if (!user || (user.tokenVersion ?? 0) !== body.tv) throw new UnauthorizedException("This reset link is no longer valid");
    await (this.prisma as any).user.update({
      where: { id: user.id },
      data: { passwordHash: hashSync(newPassword, 10), tokenVersion: (user.tokenVersion ?? 0) + 1 },
    });
    await this.audit.log({ userId: user.id, action: "auth.password_reset_via_admin", entityType: "User", entityId: user.id });
    return { reset: true };
  }

  /** Second step of a TOTP login: exchange challenge + 6-digit code
   * for a real session token. */
  async verifyTotpLogin(challengeToken: string, code: string, ip?: string, userAgent?: string) {
    const { verifyAdminToken } = await import("../common/admin-token");
    const { verifyTotp } = await import("../common/totp");
    const { decryptJson } = await import("../integrations/crypto");
    const body = verifyAdminToken(challengeToken, "totp-challenge");
    if (!body) throw new UnauthorizedException("This sign-in challenge is invalid or has expired. Please sign in again.");
    // AB8 (AX26): a challenge minted by a Google SSO login
    // carries via:"google" — its completion is a GOOGLE login,
    // recorded as such; password challenges record "password".
    const method = (body as any).via === "google" ? "google" : "password";
    const user = await (this.prisma as any).user.findUnique({ where: { id: body.sub } });
    if (!user || user.status !== "ACTIVE" || !user.totpEnabled || !user.totpSecretEncrypted || (user.tokenVersion ?? 0) !== body.tv) {
      throw new UnauthorizedException("This sign-in challenge is no longer valid. Please sign in again.");
    }
    let secret: string;
    try { secret = (decryptJson(user.totpSecretEncrypted) as { secret: string }).secret; }
    catch { throw new UnauthorizedException("Two-factor authentication is misconfigured for this account. Contact the platform team."); }
    if (!verifyTotp(secret, code)) {
      // GB6 (GC16): a wrong code is a failed login attempt.
      await this.recordLoginEvent({ userId: body.sub, email: user.email, success: false, ip, userAgent, method });
      throw new UnauthorizedException("That authentication code is incorrect");
    }
    await (this.prisma as any).user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    await this.audit.log({ userId: user.id, action: user.isSuperAdmin ? "admin.login" : "auth.login", entityType: "User", entityId: user.id, metadata: { totp: true }, ipAddress: ip });
    await this.recordLoginEvent({ userId: user.id, email: user.email, success: true, ip, userAgent, method });
    return this.issueToken(user, { ip, userAgent });
  }

  /** AB8 (AX26): complete a Google SSO login for an ALREADY
   * VERIFIED identity (GoogleSsoService exchanged the code,
   * confirmed email_verified, and matched the email to this
   * user). Mirrors login()'s completion discipline EXACTLY:
   * a TOTP-enabled account gets a challenge (carrying
   * via:"google", so its completion records method "google")
   * and NO success event/token yet — SSO NEVER bypasses TOTP.
   * Only a plain completion records the success LoginEvent
   * (method "google") and issues the session token. */
  async completeGoogleLogin(userId: string, ip?: string, userAgent?: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("এই অ্যাকাউন্টে সাইন ইন করা যাচ্ছে না — আবার চেষ্টা করুন");
    }
    if (user.totpEnabled && user.totpSecretEncrypted) {
      const { issueAdminToken } = await import("../common/admin-token");
      return {
        requiresTotp: true,
        challengeToken: issueAdminToken({ purpose: "totp-challenge", sub: user.id, tv: user.tokenVersion ?? 0, via: "google" } as any, 5),
        user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin, totpEnabled: true },
      };
    }
    await (this.prisma as any).user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    await this.audit.log({ userId: user.id, action: user.isSuperAdmin ? "admin.login" : "auth.login", entityType: "User", entityId: user.id, metadata: { method: "google" }, ipAddress: ip });
    await this.recordLoginEvent({ userId: user.id, email: user.email, success: true, ip, userAgent, method: "google" });
    return this.issueToken(user, { ip, userAgent });
  }

  // ---- Milestone 35 (Phase N1): self-service TOTP for ANY user ----
  // The challenge machinery (login + verify) has existed since M28
  // but enrolment was admin-surface only. These endpoints give
  // tenant users the same enrol/confirm/disable lifecycle, storing
  // the secret AES-GCM encrypted exactly like the admin flow.

  async totpStatus(userId: string) {
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId }, select: { totpEnabled: true, totpSecretEncrypted: true },
    });
    if (!user) throw new NotFoundException("User not found");
    return { totpEnabled: user.totpEnabled === true, enrolmentInProgress: Boolean(user.totpSecretEncrypted) && user.totpEnabled !== true };
  }

  async totpEnroll(userId: string, ip?: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (user.totpEnabled) throw new BadRequestException("Two-factor authentication is already enabled. Disable it first to re-enrol.");
    const { generateTotpSecret, otpauthUrl } = await import("../common/totp");
    const { encryptJson } = await import("../integrations/crypto");
    const secret = generateTotpSecret();
    await (this.prisma as any).user.update({
      where: { id: userId },
      data: { totpSecretEncrypted: encryptJson({ secret }), totpEnabled: false },
    });
    await this.audit.log({ userId, action: "auth.totp_enroll_started", entityType: "User", entityId: userId, ipAddress: ip });
    // Returned ONCE, to the owner, for authenticator entry; stored
    // encrypted and never returned again.
    const url = otpauthUrl(secret, user.email);
    // Admin Polish AP1: a scannable QR of the same otpauth URL
    // (undefined if rendering fails — enrolment never blocks).
    const { qrDataUrlFor } = await import("../common/totp");
    const qrDataUrl = await qrDataUrlFor(url);
    return { secret, otpauthUrl: url, qrDataUrl, note: "Scan the QR code with your authenticator app (or enter the secret manually), then confirm with a 6-digit code. Two-factor stays OFF until confirmation." };
  }

  private async ownTotpSecret(userId: string): Promise<string> {
    const { decryptJson } = await import("../integrations/crypto");
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEncrypted) throw new BadRequestException("No two-factor enrolment in progress. Start enrolment first.");
    return (decryptJson(user.totpSecretEncrypted) as { secret: string }).secret;
  }

  async totpConfirm(userId: string, code: string, ip?: string) {
    const { verifyTotp } = await import("../common/totp");
    const secret = await this.ownTotpSecret(userId);
    if (!verifyTotp(secret, code)) throw new BadRequestException("That code is incorrect — check the time on your device and try again");
    await (this.prisma as any).user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.log({ userId, action: "auth.totp_enabled", entityType: "User", entityId: userId, ipAddress: ip });
    return { totpEnabled: true };
  }

  async totpDisable(userId: string, code: string, ip?: string) {
    const { verifyTotp } = await import("../common/totp");
    const secret = await this.ownTotpSecret(userId);
    if (!verifyTotp(secret, code)) throw new BadRequestException("That code is incorrect");
    await (this.prisma as any).user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecretEncrypted: null } });
    await this.audit.log({ userId, action: "auth.totp_disabled", entityType: "User", entityId: userId, ipAddress: ip });
    return { totpEnabled: false };
  }

  async me(userId: string) {
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, isSuperAdmin: true, createdAt: true,
        // GC21 (GB9): verification status surface. Additive —
        // existing consumers keep working untouched.
        emailVerifiedAt: true, phoneVerifiedAt: true, phone: true,
      },
    });
    if (!user) throw new UnauthorizedException("User not found");
    // verificationRequired mirrors the JwtAuthGuard gate exactly
    // (same helper): the web shell uses it to show the blocking
    // verification wall before any tenant call starts failing.
    const gate = await readEmailVerificationGate(this.prisma as any).catch(() => ({ enforced: false, since: null }));
    return {
      ...user,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt ?? null,
      phone: user.phone ?? null,
      verificationRequired: verificationRequiredFor(user, gate),
    };
  }

  // ---- GB6 (GC16): own sessions + login history ----

  /** The caller's active sessions, newest first (cap 50), with
   * the current one flagged from the token's sid claim. */
  async mySessions(userId: string, currentSid?: string) {
    try {
      const rows = (await (this.prisma as any).userSession?.findMany?.({
        where: { userId, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 50,
      })) ?? [];
      return (rows as any[]).map((s) => ({
        id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt,
        ip: s.ip ?? null, userAgent: s.userAgent ?? null,
        current: currentSid != null && s.id === currentSid,
      }));
    } catch { return []; }
  }

  /** Revoke one of the caller's OWN sessions (another user's
   * session id reads as not found). Already-revoked is ok. */
  async revokeMySession(userId: string, sessionId: string) {
    let session: any = null;
    try {
      session = await (this.prisma as any).userSession?.findFirst?.({ where: { id: sessionId, userId } });
    } catch { session = null; }
    if (!session) throw new NotFoundException("Session not found");
    const alreadyRevoked = Boolean(session.revokedAt);
    if (!alreadyRevoked) {
      await (this.prisma as any).userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    }
    return { ok: true, id: session.id, alreadyRevoked };
  }

  /** The caller's own last 50 login events, newest first. */
  async myLoginHistory(userId: string) {
    try {
      const rows = (await (this.prisma as any).loginEvent?.findMany?.({
        where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
      })) ?? [];
      return (rows as any[]).map((r) => ({
        success: r.success === true, email: r.email,
        ip: r.ip ?? null, userAgent: r.userAgent ?? null, createdAt: r.createdAt,
      }));
    } catch { return []; }
  }

  private async issueToken(user: { id: string; email: string; isSuperAdmin: boolean; name: string }, ctx?: { ip?: string; userAgent?: string }) {
    // GB6 (GC16): register a server-side session row and carry
    // its id as the `sid` claim, so the session can later be
    // revoked (JwtAuthGuard rejects revoked sids). ANY failure
    // here signs WITHOUT sid — the legacy stateless behaviour —
    // and never blocks a login.
    let sid: string | undefined;
    try {
      const row = await (this.prisma as any).userSession?.create?.({
        data: {
          userId: user.id,
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ? String(ctx.userAgent).slice(0, 200) : null,
        },
      });
      if (row?.id) sid = String(row.id);
    } catch { sid = undefined; }
    const accessToken = await this.jwt.signAsync({
      sub: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin, tv: (user as any).tokenVersion ?? 0,
      ...(sid ? { sid } : {}),
    });
    return { accessToken, user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin } };
  }
}
