import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { unseal } from "../common/platform-config";
import { bdPhoneMatchKey } from "../orders/phone-utils";
import { IdentifierListsService } from "./identifier-lists.service";
import { FraudAttemptLogService } from "./fraud-attempt-log.service";
import { TurnstileVerifier } from "./turnstile.service";
import { fraudRuleMatches } from "./fraud-rules.service";
import { deviceHashPrefix, maskIdentifier, maskPhoneSummary, normalizeDeviceHash } from "./identifier-utils";

/**
 * GB3 (GC9): the public checkout / OTP gate. Builder B wires
 * this into the shop / single / landing checkouts and the OTP
 * sender; the gate itself owns every refusal decision so all
 * surfaces refuse identically.
 *
 * Contract: evaluateGate returns { trusted, warnOpenOrder } on
 * pass and THROWS BadRequestException with a GENERIC Bengali
 * message on refusal (never naming the list/rule that fired),
 * writing exactly ONE FraudAttemptLog row per refusal.
 *
 * Order of checks (brief-pinned):
 *  1. trusted phone (bypasses 2–4, NEVER the CAPTCHA check)
 *  2. blocked identifier (phone/email/ip), plus the GB6 (GC15)
 *     blocked CUSTOMER record whose phone matches
 *  3. open-order policy (block refuses / warn flags)
 *  4. waiting period, then per-day phone limit
 *  5. CAPTCHA (Turnstile) — independent of trust. When
 *     captchaEnabled but the site key or the sealed secret is
 *     missing, CAPTCHA is treated as NOT CONFIGURED and
 *     skipped: a half-configured setting must never hard-fail
 *     every checkout (the settings UI warns instead).
 */

export const GB3_FRAUD_SETTING_DEFAULTS = {
  openOrderPolicy: "off",
  openOrderWindowHours: 72,
  waitingPeriodMinutes: 0,
  maxOrdersPerPhonePerDay: 0,
  turnstileSiteKey: null as string | null,
  turnstileSecretEncrypted: null as string | null,
  captchaEnabled: false,
  captchaOnCheckout: true,
  captchaOnOtp: false,
} as const;

const OPEN_STATUSES = ["pending", "on-hold", "processing"];

const ORDER_REFUSAL = "দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না";
const OTP_REFUSAL = "দুঃখিত, এই মুহূর্তে কোড পাঠানো যাচ্ছে না";
const OPEN_ORDER_REFUSAL = "আপনার আগের অর্ডারটি এখনো প্রক্রিয়াধীন আছে — সেটি সম্পন্ন হলে আবার চেষ্টা করুন";
const CAPTCHA_REFUSAL = "নিরাপত্তা যাচাই ব্যর্থ হয়েছে — আবার চেষ্টা করুন";

/** Start of the current Asia/Dhaka calendar day as a UTC
 * instant. Dhaka is UTC+6 fixed (no DST), so midnight Dhaka
 * is 18:00 UTC the previous day: take the en-CA Dhaka date
 * string (the order-queues.dhakaTodayString technique) and
 * parse it back with an explicit +06:00 offset. */
export function dhakaDayStartUtc(now: Date = new Date()): Date {
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(now);
  return new Date(`${dateStr}T00:00:00.000+06:00`);
}

@Injectable()
export class CheckoutGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierListsService,
    private readonly attempts: FraudAttemptLogService,
    @Optional() private readonly turnstile?: TurnstileVerifier,
  ) {}

  /** FraudShieldSetting row or the in-code defaults — read-only
   * (never creates a row from a public gate) and resilient like
   * FraudShieldService.loadSettingsRow. */
  async loadFraudSettings(orgId: string): Promise<any> {
    try {
      const table = (this.prisma as any).fraudShieldSetting;
      if (!table) return { ...GB3_FRAUD_SETTING_DEFAULTS };
      let row = null;
      if (table.findUnique) row = await table.findUnique({ where: { organizationId: orgId } }).catch(() => null);
      if (!row && table.findFirst) row = await table.findFirst({ where: { organizationId: orgId } }).catch(() => null);
      if (row) return { ...GB3_FRAUD_SETTING_DEFAULTS, ...row };
      return { ...GB3_FRAUD_SETTING_DEFAULTS };
    } catch {
      return { ...GB3_FRAUD_SETTING_DEFAULTS };
    }
  }

  /** Customer ids in the org whose stored phone matches the
   * phone match-key (bounded scan, comparison-time matching —
   * stored phones are never rewritten). */
  private async matchingCustomerIds(orgId: string, phoneKey: string): Promise<string[]> {
    try {
      const customers: any[] = ((await (this.prisma as any).customer?.findMany({
        where: { organizationId: orgId },
        take: 5000,
      }).catch(() => [])) ?? []);
      return customers
        .filter((c: any) => bdPhoneMatchKey(c?.phone ?? null) === phoneKey)
        .map((c: any) => String(c.id));
    } catch {
      return [];
    }
  }

  private async ordersForCustomers(orgId: string, customerIds: string[]): Promise<any[]> {
    if (!customerIds.length) return [];
    try {
      const rows: any[] = ((await (this.prisma as any).order?.findMany({
        where: { organizationId: orgId, customerId: { in: customerIds } },
        orderBy: { createdAt: "desc" },
        take: 5000,
      }).catch(() => [])) ?? []);
      return rows.filter((o: any) => o.isPractice !== true);
    } catch {
      return [];
    }
  }

  /** Open orders (pending/on-hold/processing, non-practice)
   * for a phone in the trailing window. */
  async countOpenOrders(
    orgId: string,
    phoneKey: string,
    windowHours: number,
    excludeOrderId?: string | null,
  ): Promise<number> {
    try {
      if (!phoneKey) return 0;
      const ids = await this.matchingCustomerIds(orgId, phoneKey);
      const orders = await this.ordersForCustomers(orgId, ids);
      const since = Date.now() - Number(windowHours ?? 72) * 3600 * 1000;
      return orders.filter((o: any) => {
        if (excludeOrderId && String(o.id) === String(excludeOrderId)) return false;
        if (!OPEN_STATUSES.includes(String(o.status))) return false;
        const t = new Date(o.createdAt ?? 0).getTime();
        return !Number.isNaN(t) && t >= since;
      }).length;
    } catch {
      return 0;
    }
  }

  /** Phone order stats: openCount over windowHours (default
   * 72), the most recent order time (any status, for the
   * waiting-period cooldown), and today's count (Asia/Dhaka
   * calendar day) for the per-day limit. */
  async phoneOrderStats(
    orgId: string,
    phoneKey: string,
    windowHours: number = 72,
  ): Promise<{ openCount: number; lastOrderAt: Date | null; todayCount: number }> {
    try {
      if (!phoneKey) return { openCount: 0, lastOrderAt: null, todayCount: 0 };
      const ids = await this.matchingCustomerIds(orgId, phoneKey);
      const orders = await this.ordersForCustomers(orgId, ids);
      const since = Date.now() - Number(windowHours ?? 72) * 3600 * 1000;
      const dayStart = dhakaDayStartUtc().getTime();
      let openCount = 0;
      let todayCount = 0;
      let lastOrderAt: Date | null = null;
      for (const o of orders) {
        const t = new Date(o.createdAt ?? 0).getTime();
        if (Number.isNaN(t)) continue;
        if (!lastOrderAt || t > lastOrderAt.getTime()) lastOrderAt = new Date(t);
        if (t >= dayStart) todayCount += 1;
        if (OPEN_STATUSES.includes(String(o.status)) && t >= since) openCount += 1;
      }
      return { openCount, lastOrderAt, todayCount };
    } catch {
      return { openCount: 0, lastOrderAt: null, todayCount: 0 };
    }
  }

  private defaultSummary(input: { phone?: string | null; email?: string | null; ip?: string | null }): string {
    if (input.phone) return maskPhoneSummary(input.phone);
    if (input.ip) return maskIdentifier("ip", input.ip);
    if (input.email) return maskIdentifier("email", input.email);
    return "অজানা";
  }

  async evaluateGate(
    orgId: string,
    channel: string,
    input: {
      phone?: string | null;
      email?: string | null;
      ip?: string | null;
      deviceHash?: string | null;
      captchaToken?: string | null;
      surface: "checkout" | "otp";
    },
  ): Promise<{ trusted: boolean; warnOpenOrder: boolean }> {
    const surface = input.surface === "otp" || channel === "otp" ? "otp" : "checkout";
    const genericRefusal = surface === "otp" ? OTP_REFUSAL : ORDER_REFUSAL;
    const settings = await this.loadFraudSettings(orgId);
    const phoneKey = input.phone ? bdPhoneMatchKey(input.phone) : null;

    const refuse = async (kind: string, summary: string, message: string): Promise<never> => {
      await this.attempts.log(orgId, { channel, kind, identifierSummary: summary }).catch(() => undefined);
      throw new BadRequestException(message);
    };

    // 1. Trusted phone?
    let trusted = false;
    if (phoneKey && this.identifiers?.isTrustedPhone) {
      trusted = await this.identifiers.isTrustedPhone(orgId, phoneKey).catch(() => false);
    }

    // 2. Blocked identifier (skipped for trusted phones).
    if (!trusted && this.identifiers?.isBlocked) {
      const deviceHash = normalizeDeviceHash(input.deviceHash ?? null);
      const res = await this.identifiers
        .isBlocked(orgId, { phoneKey, email: input.email ?? null, ip: input.ip ?? null, deviceHash })
        .catch(() => ({ blocked: false, kind: null as string | null }));
      if (res.blocked) {
        const summary = res.kind === "device" && deviceHash
          ? `${deviceHashPrefix(deviceHash)}…`
          : res.kind === "email" && input.email
            ? maskIdentifier("email", input.email)
            : res.kind === "ip" && input.ip
              ? maskIdentifier("ip", input.ip)
              : this.defaultSummary(input);
        await refuse("blocked_identifier", summary, genericRefusal);
      }
    }

    // 2b. GB6 (GC15): blocked CUSTOMER record — a customer whose
    // phone matches (comparison-time match-key, same scan as the
    // order stats) and whose record is staff-blocked refuses with
    // the SAME generic message. Part of the step-2 family: still
    // inside the !trusted branch, and FAIL OPEN on any error,
    // exactly like the neighbouring checks.
    if (!trusted && phoneKey) {
      let customerBlocked = false;
      try {
        const ids = await this.matchingCustomerIds(orgId, phoneKey);
        if (ids.length) {
          const rows: any[] = ((await (this.prisma as any).customer?.findMany({
            where: { organizationId: orgId, id: { in: ids } },
            select: { id: true, isBlocked: true },
          }).catch(() => [])) ?? []);
          const wanted = new Set(ids.map(String));
          customerBlocked = rows.some((c: any) => wanted.has(String(c?.id)) && c?.isBlocked === true);
        }
      } catch { customerBlocked = false; }
      if (customerBlocked) {
        await refuse("customer_block", maskPhoneSummary(input.phone), genericRefusal);
      }
    }

    let warnOpenOrder = false;

    if (!trusted && surface === "checkout" && phoneKey) {
      const windowHours = Number(settings.openOrderWindowHours ?? 72) || 72;
      const policy = String(settings.openOrderPolicy ?? "off");
      // 3. Open-order policy.
      if (policy === "block" || policy === "warn") {
        const openCount = await this.countOpenOrders(orgId, phoneKey, windowHours).catch(() => 0);
        if (openCount >= 1) {
          if (policy === "block") {
            await refuse("open_order_policy", maskPhoneSummary(input.phone), OPEN_ORDER_REFUSAL);
          } else {
            warnOpenOrder = true;
          }
        }
      }
      // 4. Waiting period + per-day limit.
      const waiting = Number(settings.waitingPeriodMinutes ?? 0) || 0;
      const maxPerDay = Number(settings.maxOrdersPerPhonePerDay ?? 0) || 0;
      if (waiting > 0 || maxPerDay > 0) {
        const stats = await this.phoneOrderStats(orgId, phoneKey, windowHours).catch(
          () => ({ openCount: 0, lastOrderAt: null as Date | null, todayCount: 0 }),
        );
        if (waiting > 0 && stats.lastOrderAt) {
          const elapsedMs = Date.now() - stats.lastOrderAt.getTime();
          if (elapsedMs >= 0 && elapsedMs < waiting * 60 * 1000) {
            await refuse("waiting_period", maskPhoneSummary(input.phone), genericRefusal);
          }
        }
        if (maxPerDay > 0 && stats.todayCount >= maxPerDay) {
          await refuse("daily_limit", maskPhoneSummary(input.phone), genericRefusal);
        }
      }
    }

    // 5. CAPTCHA — independent of trust. Half-configured
    // (enabled but site key or secret missing) = not
    // configured: skip, never hard-fail every checkout.
    const captchaApplies = settings.captchaEnabled === true &&
      (surface === "otp" ? settings.captchaOnOtp === true : settings.captchaOnCheckout !== false);
    if (captchaApplies) {
      const siteKey = settings.turnstileSiteKey ? String(settings.turnstileSiteKey) : null;
      const secret = unseal(settings.turnstileSecretEncrypted) ?? null;
      if (siteKey && secret) {
        const verifier = this.turnstile ?? new TurnstileVerifier();
        const result = await verifier
          .verify(secret, input.captchaToken ?? null, input.ip ?? null)
          .catch(() => ({ ok: false, providerError: true }));
        if (!result.ok) {
          const base = this.defaultSummary(input);
          const summary = result.providerError ? `${base} (provider_error)` : base;
          await refuse("captcha", summary, CAPTCHA_REFUSAL);
        }
      }
    }

    return { trusted, warnOpenOrder };
  }

  /** block_checkout fraud rules at the gate. Returns the first
   * matching rule (hit + attempt rows written) or null.
   * minRiskScore conditions are IGNORED here (post-placement
   * only — see fraud-rules.service). Never throws: a rule
   * engine failure must not break checkout. The CALLER throws
   * the generic refusal when blockedBy is non-null. */
  async evaluateFraudRulesAtCheckout(
    orgId: string,
    facts: {
      totalMinor: bigint;
      isCod: boolean;
      district: string | null;
      openOrderCount: number;
      phone?: string | null;
      channel?: string;
    },
  ): Promise<{ blockedBy: { ruleId: string; name: string } | null }> {
    try {
      const table = (this.prisma as any).fraudRule;
      if (!table?.findMany) return { blockedBy: null };
      const rules: any[] = ((await table.findMany({
        where: { organizationId: orgId, enabled: true, action: "block_checkout" },
        orderBy: { createdAt: "asc" },
      }).catch(() => [])) ?? []);
      for (const rule of rules) {
        const matched = fraudRuleMatches(
          rule.conditions,
          {
            totalMinor: facts.totalMinor,
            isCod: facts.isCod,
            district: facts.district ?? null,
            openOrderCount: Number(facts.openOrderCount ?? 0),
          },
          { atCheckout: true },
        );
        if (!matched) continue;
        try {
          const hits = (this.prisma as any).fraudRuleHit;
          if (hits?.create) {
            await hits.create({
              data: { organizationId: orgId, ruleId: rule.id, orderId: null, action: "block_checkout" },
            }).catch(() => undefined);
          }
        } catch { /* hit ledger is best-effort */ }
        await this.attempts.log(orgId, {
          channel: facts.channel ?? "shop",
          kind: "fraud_rule",
          identifierSummary: facts.phone ? maskPhoneSummary(facts.phone) : "অজানা",
          ruleId: rule.id,
        }).catch(() => undefined);
        return { blockedBy: { ruleId: String(rule.id), name: String(rule.name ?? "") } };
      }
      return { blockedBy: null };
    } catch {
      return { blockedBy: null };
    }
  }
}
