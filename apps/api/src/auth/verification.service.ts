import { BadRequestException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { SmsProvider } from "../messaging/sms.provider";
import { normalizeBdPhone as normalizeOn11 } from "../orders/phone-utils";
import { normalizeBdPhone as normalizeGatewayPhone } from "../messaging/sms.provider";
import { platformSetting } from "../common/platform-settings";
import { badRequest, normalizeApiLocale, notFound, renderMessage, tooManyRequests } from "../i18n";

/**
 * GC21 (GB9) — Merchant Trust: account verification.
 *
 * Email: a 32-byte random token, stored ONLY as its SHA-256 hash
 * (VerificationToken, kind "email", 24h expiry). The raw token
 * travels exclusively inside the emailed link — it is never
 * logged, audited, or returned by any API response.
 *
 * Phone: a 6-digit OTP, stored ONLY as a SHA-256 hash bound to
 * the user id (kind "phone", 5-minute expiry), mirroring the
 * EC25 shop-OTP discipline: one constant Bengali failure message,
 * a 5-attempt cap after which the code is dead, a 60-second
 * resend cooldown and a 3-per-hour cap. Sending goes through the
 * PLATFORM SmsProvider (Admin Console / env config); when the
 * platform SMS is not configured the request creates NOTHING and
 * answers honestly with reason "sms_not_configured".
 *
 * Every send failure is isolated: it never blocks registration,
 * login, or any other flow — callers get { sent: false, reason }.
 */

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PHONE_OTP_TTL_MS = 5 * 60 * 1000;
const PHONE_OTP_MAX_ATTEMPTS = 5;
const PHONE_RESEND_COOLDOWN_MS = 60 * 1000;
const PHONE_HOURLY_CAP = 3;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function webBase(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The platform gate, SystemSetting "emailVerificationGate". */
export interface EmailVerificationGate {
  enforced: boolean;
  /** Users created at/after this instant must be verified. */
  since: Date | null;
}

export async function readEmailVerificationGate(prisma: any): Promise<EmailVerificationGate> {
  try {
    const raw = (await platformSetting(prisma, "emailVerificationGate")) as any;
    if (!raw || raw.enforced !== true) return { enforced: false, since: null };
    const since = raw.since ? new Date(raw.since) : null;
    // A gate without a parseable `since` can never be evaluated
    // safely — treat it as OFF rather than locking everyone out.
    if (!since || Number.isNaN(since.getTime())) return { enforced: false, since: null };
    return { enforced: true, since };
  } catch {
    return { enforced: false, since: null };
  }
}

/** True when this user must verify before using tenant routes:
 * gate on, email unverified, and NOT grandfathered (created
 * before the gate's `since`). */
export function verificationRequiredFor(user: { emailVerifiedAt?: unknown; createdAt?: unknown } | null | undefined, gate: EmailVerificationGate): boolean {
  if (!gate.enforced || !gate.since || !user) return false;
  if (user.emailVerifiedAt) return false;
  const created = user.createdAt ? new Date(user.createdAt as any) : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  return created.getTime() >= gate.since.getTime();
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Optional (MessagingModule provides the real instances in
    // the app; unit specs substitute fakes). Absent provider =
    // "not configured", answered honestly, never faked.
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly sms?: SmsProvider,
  ) {}

  private t() { return (this.prisma as any).verificationToken; }

  private async loadUser(userId: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("auth.userNotFound");
    return user;
  }

  /** Kill every still-open token of one kind for the user by
   * expiring it (the row keeps its audit value; an expired token
   * can never verify). */
  private async invalidateOpenTokens(userId: string, kind: "email" | "phone") {
    try {
      await this.t()?.updateMany?.({
        where: { userId, kind, usedAt: null },
        data: { expiresAt: new Date() },
      });
    } catch { /* a stale token still dies at its own expiry */ }
  }

  // ---------------- Email ----------------

  /**
   * Issue a fresh email-verification token and email the link.
   * Failure-isolated by contract: SMTP problems come back as
   * { sent: false, reason } and NEVER throw into register/login.
   * The token itself is never in the return value.
   */
  async requestEmailVerification(userId: string): Promise<{ sent: boolean; reason?: string }> {
    const user = await this.loadUser(userId);
    if (user.emailVerifiedAt) return { sent: false, reason: "already_verified" };
    await this.invalidateOpenTokens(userId, "email");
    const token = randomBytes(32).toString("hex");
    const row = await this.t().create({
      data: {
        userId, kind: "email", tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS), attempts: 0,
      },
    });
    if (!this.email || (typeof this.email.isConfigured === "function" && !this.email.isConfigured())) {
      return { sent: false, reason: "email_not_configured" };
    }
    const link = `${webBase()}/verify-email?token=${token}`;
    // ML11 slice (MB4): platform auth email renders from the
    // message catalog in the recipient's locale — the user's
    // preferredLocale when set, else bn (pre-login rule).
    // (Keys live in catalog/auth.ts until the coordinator moves
    // them into the shared notifications catalog.)
    const locale = normalizeApiLocale((user as any).preferredLocale);
    const greeting = renderMessage(locale, "auth.emailVerifyGreeting", { name: user.name ?? "" });
    try {
      await this.email.send({
        to: user.email,
        subject: renderMessage(locale, "auth.emailVerifySubject"),
        text: `${greeting}\n\n${renderMessage(locale, "auth.emailVerifyBody")}\n${link}\n\n${renderMessage(locale, "auth.emailVerifyIgnore")}`,
        html: `<p>${greeting}</p><p>${renderMessage(locale, "auth.emailVerifyBodyHtml")}</p><p><a href="${link}">${renderMessage(locale, "auth.emailVerifyButton")}</a></p><p>${renderMessage(locale, "auth.emailVerifyIgnore")}</p>`,
      });
    } catch {
      return { sent: false, reason: "provider_error" };
    }
    await this.audit.log({ userId, action: "auth.email_verification.requested", entityType: "User", entityId: userId, metadata: { tokenId: row?.id ?? undefined } });
    return { sent: true };
  }

  /**
   * Consume an emailed token. An already-verified user clicking
   * again (same or an older link) gets a clear success, not an
   * error — inboxes and double-clicks make that the common case.
   */
  async verifyEmail(tokenRaw: string) {
    const token = String(tokenRaw ?? "").trim();
    if (!token) throw badRequest("auth.verificationLinkInvalid");
    const row = await this.t()?.findFirst?.({ where: { tokenHash: sha256Hex(token), kind: "email" } }).catch(() => null);
    if (!row) throw badRequest("auth.verificationLinkInvalidOrExpired");
    const user = await (this.prisma as any).user.findUnique({ where: { id: row.userId } });
    if (!user) throw badRequest("auth.verificationLinkInvalidOrExpired");
    if (user.emailVerifiedAt) {
      if (!row.usedAt) {
        await this.t().update({ where: { id: row.id }, data: { usedAt: new Date() } }).catch(() => undefined);
      }
      return { verified: true, alreadyVerified: true };
    }
    if (row.usedAt) throw badRequest("auth.verificationLinkAlreadyUsed");
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      throw badRequest("auth.verificationLinkExpired");
    }
    const now = new Date();
    await (this.prisma as any).user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
    await this.t().update({ where: { id: row.id }, data: { usedAt: now } });
    await this.audit.log({ userId: user.id, action: "auth.email_verified", entityType: "User", entityId: user.id });
    return { verified: true, alreadyVerified: false };
  }

  // ---------------- Phone ----------------

  /**
   * Set (or change) the account phone. Stores the ON11 canonical
   * "+8801XXXXXXXXX" form. Changing to a DIFFERENT number resets
   * phoneVerifiedAt — a verified stamp never carries over to a
   * number that was never verified.
   */
  async setPhone(userId: string, phoneRaw: string) {
    const user = await this.loadUser(userId);
    const canonical = normalizeOn11(phoneRaw);
    if (!canonical) throw badRequest("auth.bdMobileNumberInvalid");
    const changed = (user.phone ?? null) !== canonical;
    const data: Record<string, unknown> = { phone: canonical };
    if (changed) data.phoneVerifiedAt = null;
    const updated = await (this.prisma as any).user.update({ where: { id: userId }, data });
    if (changed) {
      await this.audit.log({ userId, action: "auth.phone_updated", entityType: "User", entityId: userId });
    }
    return { phone: updated.phone ?? canonical, phoneVerifiedAt: updated.phoneVerifiedAt ?? null };
  }

  /**
   * Request a phone OTP via the PLATFORM SMS config. When the
   * platform SMS is not configured: creates NOTHING and answers
   * { sent: false, reason: "sms_not_configured" } — the UI shows
   * an honest "এসএমএস যাচাই এখন উপলব্ধ নয়" state.
   */
  async requestPhoneOtp(userId: string): Promise<{ sent: boolean; reason?: string; expiresInSeconds?: number }> {
    const user = await this.loadUser(userId);
    if (!user.phone) throw badRequest("auth.mobileNumberRequiredFirst");
    if (user.phoneVerifiedAt) return { sent: false, reason: "already_verified" };
    if (!this.sms || (typeof this.sms.isConfigured === "function" && !this.sms.isConfigured())) {
      return { sent: false, reason: "sms_not_configured" };
    }
    const now = new Date();
    // Resend discipline (EC25 shop OTP, mirrored): 60s cooldown
    // between sends and at most 3 codes per hour per user.
    const recent: any[] = (await this.t()?.findMany?.({
      where: { userId, kind: "phone" }, orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    const withinHour = recent.filter((r) => now.getTime() - new Date(r.createdAt).getTime() < 60 * 60 * 1000);
    if (withinHour.length >= PHONE_HOURLY_CAP) {
      throw tooManyRequests("auth.codeRequestedTooOften");
    }
    const latest = recent[0];
    if (latest && now.getTime() - new Date(latest.createdAt).getTime() < PHONE_RESEND_COOLDOWN_MS) {
      throw tooManyRequests("auth.waitAndRetry");
    }
    await this.invalidateOpenTokens(userId, "phone");
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const row = await this.t().create({
      data: {
        userId, kind: "phone", tokenHash: sha256Hex(`${userId}:${code}`),
        expiresAt: new Date(now.getTime() + PHONE_OTP_TTL_MS), attempts: 0,
      },
    });
    const to = normalizeGatewayPhone(String(user.phone)) ?? String(user.phone).replace(/\D/g, "");
    try {
      await this.sms.send({
        to,
        text: renderMessage(normalizeApiLocale((user as any).preferredLocale), "auth.phoneOtpSmsText", { code }),
        reference: `user-otp-${row.id}`,
      });
    } catch {
      // A failed send kills the code — nothing is verifiable and
      // nothing is claimed sent.
      await this.t().update({ where: { id: row.id }, data: { expiresAt: new Date() } }).catch(() => undefined);
      return { sent: false, reason: "provider_error" };
    }
    await this.audit.log({ userId, action: "auth.phone_otp.requested", entityType: "User", entityId: userId });
    return { sent: true, expiresInSeconds: 300 };
  }

  /**
   * Verify a phone OTP. One constant failure message for every
   * failure mode (EC25 discipline); the 5th wrong attempt kills
   * the code. The code is never logged or echoed back.
   */
  async verifyPhoneOtp(userId: string, codeRaw: string) {
    const fail = (): never => { throw badRequest("auth.otpCodeFailed"); };
    const open: any[] = (await this.t()?.findMany?.({
      where: { userId, kind: "phone", usedAt: null }, orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    const row = open[0];
    if (!row) fail();
    if (new Date(row.expiresAt).getTime() <= Date.now()) fail();
    if (Number(row.attempts ?? 0) >= PHONE_OTP_MAX_ATTEMPTS) fail();
    const candidate = sha256Hex(`${userId}:${String(codeRaw ?? "").trim()}`);
    const a = Buffer.from(candidate);
    const b = Buffer.from(String(row.tokenHash ?? ""));
    const matches = a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      const attempts = Number(row.attempts ?? 0) + 1;
      await this.t().update({
        where: { id: row.id },
        data: { attempts, ...(attempts >= PHONE_OTP_MAX_ATTEMPTS ? { usedAt: new Date() } : {}) },
      }).catch(() => undefined);
      fail();
    }
    const now = new Date();
    await (this.prisma as any).user.update({ where: { id: userId }, data: { phoneVerifiedAt: now } });
    await this.t().update({ where: { id: row.id }, data: { usedAt: now } });
    await this.audit.log({ userId, action: "auth.phone_verified", entityType: "User", entityId: userId });
    return { verified: true, phoneVerifiedAt: now };
  }
}
