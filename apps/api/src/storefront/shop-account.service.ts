import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SmsProvider, normalizeBdPhone } from "../messaging/sms.provider";
import { tenantSmsFromRow } from "../messaging/sender-config";
import { phoneKeyLoose } from "../commerce/promotions";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { PromotionsService } from "../commerce/promotions.service";
import { LoyaltyService } from "../commerce/loyalty.service";
import { hashShopSecret } from "./shop-auth.util";
import { stockStateOf } from "./storefront.service";
import type {
  CreateAddressDto,
  UpdateAddressDto,
  UpdateProfileDto,
} from "./storefront.dto";

const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const OTP_FAILURE_MESSAGE = "কোডটি সঠিক নয় অথবা মেয়াদ শেষ হয়ে গেছে";

/**
 * EC25 (the EC17 completion) — native-storefront customer
 * accounts: phone-OTP login, 30-day sessions, profile, saved
 * addresses, order history / reorder, and the wishlist.
 *
 * Honesty + safety discipline:
 *  - Only SHA-256 hashes of OTP codes and session tokens are
 *    stored; the code/token itself is never logged or returned
 *    (the token is returned exactly once, at verify time).
 *  - OTP verify has ONE constant failure message for every
 *    failure mode, so the endpoint cannot be used to probe
 *    which part failed.
 *  - OTP SMS goes through the tenant's own Messaging sender
 *    config when configured, else the platform SMS path; when
 *    neither exists the request fails honestly (400) and the
 *    challenge is consumed — no pretend-sent code.
 *  - Every row is resolved org-first; a session minted for one
 *    shop is meaningless at another.
 */
@Injectable()
export class ShopAccountService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly sms?: SmsProvider,
    // GB3 (GC9): OTP gate (blocked identifiers + CAPTCHA on the
    // otp surface). LAST param + Optional; absent keeps OTP
    // exactly as before GB3.
    @Optional() private readonly guard?: CheckoutGuardService,
    // AB1 (AX1/AX2): the customer's own loyalty + referral
    // surface. LAST params + Optional; absent answers the
    // loyalty surface with an honest disabled shape (the module
    // always provides them in the real runtime).
    @Optional() private readonly promotions?: PromotionsService,
    @Optional() private readonly loyalty?: LoyaltyService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ================= Shop / customer resolution =================

  private async findOrgBySlug(orgSlug: string): Promise<any | null> {
    if (!orgSlug) return null;
    return this.t("organization").findFirst({ where: { slug: orgSlug } });
  }

  /** Same gate as StorefrontService.requireEnabledShop. */
  private async requireShop(orgSlug: string): Promise<{ org: any; setting: any }> {
    const org = await this.findOrgBySlug(orgSlug);
    if (!org) throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    let setting: any = null;
    try {
      setting = await this.t("storefrontSetting").findFirst({
        where: { organizationId: org.id },
      });
    } catch {
      setting = null;
    }
    if (!setting || setting.shopEnabled !== true) {
      throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    }
    return { org, setting };
  }

  /** Loose phone match — the same algorithm as
   * StorefrontService.findCustomerByPhone (digits; 880→0 prefix
   * on 13 digits; last 11 when longer). */
  private async findCustomerByPhoneLoose(orgId: string, phone: string | null | undefined): Promise<any | null> {
    if (!phone?.trim()) return null;
    try {
      const table = this.t("customer");
      if (!table?.findMany) return null;
      const normalize = (v: unknown): string => {
        let digits = String(v ?? "").replace(/\D/g, "");
        if (digits.startsWith("880") && digits.length === 13) digits = `0${digits.slice(3)}`;
        if (digits.length > 11) digits = digits.slice(-11);
        return digits;
      };
      const wanted = normalize(phone);
      if (!wanted) return null;
      const rows: any[] = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
      return rows.find((c) => normalize(c.phone) === wanted) ?? null;
    } catch {
      return null;
    }
  }

  private customerName(customer: any): string | null {
    const name = [customer?.firstName, customer?.lastName]
      .filter((x) => x !== null && x !== undefined && String(x).trim())
      .map((x) => String(x).trim())
      .join(" ")
      .trim();
    return name || null;
  }

  private serializeCustomer(customer: any) {
    return {
      id: customer.id,
      name: this.customerName(customer),
      phone: customer.phone ?? null,
      email: customer.email ?? null,
    };
  }

  private serializeAddress(a: any) {
    return {
      id: a.id,
      label: a.label ?? null,
      recipientName: a.recipientName,
      phone: a.phone,
      addressLine: a.addressLine,
      district: a.district,
      isDefault: !!a.isDefault,
    };
  }

  // ================= OTP =================

  private async consumeChallenge(challengeId: string): Promise<void> {
    try {
      await this.t("shopOtpChallenge").update({
        where: { id: challengeId },
        data: { consumedAt: new Date() },
      });
    } catch {
      /* consumption is best-effort bookkeeping on error paths */
    }
  }

  /** Defensive tenant-SMS row read (MessagingService precedent):
   * any failure / missing table reads as "no tenant config". */
  private async resolveTenantSms(organizationId: string): Promise<any | null> {
    try {
      const row =
        (await (this.prisma as any).messagingSenderConfig?.findUnique({
          where: { organizationId },
        })) ?? null;
      return tenantSmsFromRow(row);
    } catch {
      return null;
    }
  }

  /**
   * EC28: THE shop-surface SMS send — the one helper every
   * storefront SMS goes through (EC25 OTP, EC28 stock alerts and
   * wishlist price-drop alerts). Tenant MessagingSenderConfig
   * wins; the platform SMS path is the fallback; NEITHER
   * configured (or a gateway refusal) returns { sent: false }
   * with the reason — a send is never claimed that did not
   * happen. Callers decide how to surface the failure.
   */
  async sendShopSms(
    organizationId: string,
    phoneRaw: string,
    text: string,
    reference: string,
  ): Promise<{ sent: true } | { sent: false; notConfigured: boolean; reason: string }> {
    const to = normalizeBdPhone(String(phoneRaw)) ?? String(phoneRaw).replace(/\D/g, "");
    try {
      const tenantCfg = await this.resolveTenantSms(organizationId);
      if (tenantCfg) {
        if (!this.sms) return { sent: false, notConfigured: true, reason: "SMS provider unavailable" };
        await this.sms.sendWithGateway(tenantCfg.gateway, tenantCfg, { to, text, reference });
        return { sent: true };
      }
      if (this.sms?.isConfigured()) {
        await this.sms.send({ to, text, reference });
        return { sent: true };
      }
      return { sent: false, notConfigured: true, reason: "no SMS sender configured" };
    } catch (e) {
      return {
        sent: false,
        notConfigured: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async requestOtp(
    orgSlug: string,
    phoneRaw: string,
    ctx?: { captchaToken?: string | null; ip?: string | null },
  ) {
    const { org, setting } = await this.requireShop(orgSlug);
    // GB3 (GC9): the OTP gate runs right after org resolution,
    // before any code is generated or sent — the guard throws
    // the generic OTP refusal + writes the attempt log itself.
    if (this.guard) {
      await this.guard.evaluateGate(org.id, "otp", {
        phone: phoneRaw,
        ip: ctx?.ip ?? null,
        captchaToken: ctx?.captchaToken ?? null,
        surface: "otp",
      });
    }
    const phoneKey = phoneKeyLoose(phoneRaw);
    if (phoneKey.length < 11) {
      throw new BadRequestException("সঠিক মোবাইল নম্বর দিন");
    }
    const now = new Date();
    const table = this.t("shopOtpChallenge");

    // Rate caps, judged on challenge createdAt for (org, phone).
    const recent: any[] =
      (await table
        .findMany({ where: { organizationId: org.id, phone: phoneKey }, orderBy: { createdAt: "desc" } })
        .catch(() => [])) ?? [];
    const withinHour = recent.filter(
      (c) => now.getTime() - new Date(c.createdAt).getTime() < 60 * 60 * 1000,
    );
    if (withinHour.length >= 3) {
      throw new HttpException("অনেকবার কোড চাওয়া হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন", 429);
    }
    const latest = recent[0];
    if (latest && now.getTime() - new Date(latest.createdAt).getTime() < 60 * 1000) {
      throw new HttpException("কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন", 429);
    }

    // Supersede: every still-open challenge for this phone dies.
    try {
      if (typeof table.updateMany === "function") {
        await table.updateMany({
          where: { organizationId: org.id, phone: phoneKey, consumedAt: null },
          data: { consumedAt: now },
        });
      } else {
        for (const c of recent) {
          if (!c.consumedAt) await this.consumeChallenge(c.id);
        }
      }
    } catch {
      /* an unsuperseded old challenge still expires on its own */
    }

    // Find-or-create the customer (the account identity IS the
    // org-scoped Customer row, matched by phone like checkout).
    let customer = await this.findCustomerByPhoneLoose(org.id, phoneRaw);
    if (!customer) {
      customer = await this.t("customer").create({
        data: {
          organizationId: org.id,
          source: "native_storefront",
          externalId: String(phoneRaw).trim(),
          phone: String(phoneRaw).trim(),
        },
      });
    }

    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const challenge = await table.create({
      data: {
        organizationId: org.id,
        phone: phoneKey,
        codeHash: hashShopSecret(`${org.id}:${phoneKey}:${code}`),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
      },
    });

    const shopName = setting.shopName || org.name;
    const text = `আপনার ${shopName} লগইন কোড: ${code} (৫ মিনিট মেয়াদ)`;
    const reference = `shop-otp-${challenge.id}`;
    // EC28: the send itself goes through the shared sendShopSms
    // helper (same tenant-config → platform fallback order as
    // before); the OTP-specific failure handling stays here:
    // the challenge dies with a failed send, "not configured"
    // gets the setup message, and a gateway refusal reaches the
    // shopper verbatim.
    const send = await this.sendShopSms(org.id, phoneRaw, text, reference);
    if (!send.sent) {
      await this.consumeChallenge(challenge.id);
      if (send.notConfigured) {
        throw new BadRequestException("এই দোকানে SMS লগইন সেটআপ করা নেই — দোকানে যোগাযোগ করুন");
      }
      throw new BadRequestException(send.reason);
    }

    return { sent: true, expiresInSeconds: 300 };
  }

  async verifyOtp(orgSlug: string, phoneRaw: string, code: string) {
    const { org } = await this.requireShop(orgSlug);
    const phoneKey = phoneKeyLoose(phoneRaw);
    const fail = (): never => {
      throw new BadRequestException(OTP_FAILURE_MESSAGE);
    };
    const table = this.t("shopOtpChallenge");
    const open: any[] =
      (await table
        .findMany({
          where: { organizationId: org.id, phone: phoneKey, consumedAt: null },
          orderBy: { createdAt: "desc" },
        })
        .catch(() => [])) ?? [];
    const challenge = open[0];
    if (!challenge) fail();
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) fail();
    if (Number(challenge.attempts ?? 0) >= 5) fail();

    const candidate = hashShopSecret(`${org.id}:${phoneKey}:${String(code ?? "").trim()}`);
    const a = Buffer.from(candidate);
    const b = Buffer.from(String(challenge.codeHash ?? ""));
    const matches = a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      const attempts = Number(challenge.attempts ?? 0) + 1;
      try {
        await table.update({
          where: { id: challenge.id },
          data: { attempts, ...(attempts >= 5 ? { consumedAt: new Date() } : {}) },
        });
      } catch {
        /* the failure answer is the same either way */
      }
      fail();
    }

    const customer = await this.findCustomerByPhoneLoose(org.id, phoneRaw);
    if (!customer) fail();

    await this.consumeChallenge(challenge.id);
    const token = randomBytes(32).toString("hex");
    await this.t("shopSession").create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        tokenHash: hashShopSecret(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { token, customer: this.serializeCustomer(customer) };
  }

  // ================= Sessions =================

  async resolveSession(orgId: string, token: string | null | undefined): Promise<any | null> {
    if (!token?.trim()) return null;
    try {
      const table = this.t("shopSession");
      if (!table?.findFirst) return null;
      const session = await table
        .findFirst({ where: { tokenHash: hashShopSecret(token.trim()) } })
        .catch(() => null);
      if (!session) return null;
      if (session.organizationId !== orgId) return null;
      if (session.revokedAt) return null;
      if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
      try {
        await table.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
      } catch {
        /* lastSeenAt is bookkeeping — never blocks the session */
      }
      const customer = await this.t("customer")
        .findFirst({ where: { id: session.customerId, organizationId: orgId } })
        .catch(() => null);
      if (!customer) return null;
      if (customer.mergedIntoId) return null;
      return customer;
    } catch {
      return null;
    }
  }

  async requireSessionCustomer(orgSlug: string, token: string | null | undefined) {
    const { org, setting } = await this.requireShop(orgSlug);
    const customer = await this.resolveSession(org.id, token);
    if (!customer) {
      throw new UnauthorizedException("লগইন সেশন পাওয়া যায়নি — আবার লগইন করুন");
    }
    return { org, setting, customer };
  }

  async logout(orgSlug: string, token: string | null | undefined) {
    const org = await this.findOrgBySlug(orgSlug);
    if (!org) throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    if (token?.trim()) {
      try {
        const table = this.t("shopSession");
        const session = await table
          ?.findFirst({ where: { tokenHash: hashShopSecret(token.trim()) } })
          .catch(() => null);
        if (session && session.organizationId === org.id && !session.revokedAt) {
          await table.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        }
      } catch {
        /* logout never leaks session state */
      }
    }
    return { loggedOut: true };
  }

  // ================= Profile / addresses =================

  private async defaultAddress(orgId: string, customerId: string): Promise<any | null> {
    try {
      const rows: any[] =
        (await this.t("customerAddress").findMany({
          where: { organizationId: orgId, customerId },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })) ?? [];
      return rows.find((r) => r.isDefault) ?? null;
    } catch {
      return null;
    }
  }

  async me(orgSlug: string, token: string | null | undefined) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const def = await this.defaultAddress(org.id, customer.id);
    return {
      customer: this.serializeCustomer(customer),
      defaultAddress: def ? this.serializeAddress(def) : null,
    };
  }

  /**
   * AB1 (AX1/AX2) — the signed-in customer's own loyalty surface:
   * balance + value, ledger history, the rewards they earned as
   * a referrer, and their referral code ("আপনার রেফারেল"). When
   * the loyalty service is unavailable (unit harnesses), answer
   * with the honest disabled shape rather than failing.
   */
  async loyaltyView(orgSlug: string, token: string | null | undefined) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const referralCode = this.promotions?.ensureCustomerReferralCode
      ? await this.promotions
          .ensureCustomerReferralCode(org.id, customer.id)
          .catch(() => customer.referralCode ?? null)
      : (customer.referralCode ?? null);
    if (!this.loyalty) {
      return {
        enabled: false,
        balance: 0,
        balanceValueMinor: 0,
        redeemValueMinorPerPoint: 0,
        entries: [],
        referralRewards: { coupons: [] },
        referralCode,
      };
    }
    const view = await this.loyalty.accountLoyalty(org.id, customer);
    return { ...view, referralCode };
  }

  async updateProfile(orgSlug: string, token: string | null | undefined, dto: UpdateProfileDto) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.firstName = dto.name.trim();
    if (dto.email !== undefined) data.email = dto.email === null ? null : dto.email.trim();
    if (Object.keys(data).length > 0) {
      await this.t("customer").update({ where: { id: customer.id }, data });
    }
    const fresh =
      (await this.t("customer")
        .findFirst({ where: { id: customer.id, organizationId: org.id } })
        .catch(() => null)) ?? { ...customer, ...data };
    const def = await this.defaultAddress(org.id, customer.id);
    return {
      customer: this.serializeCustomer(fresh),
      defaultAddress: def ? this.serializeAddress(def) : null,
    };
  }

  async listAddresses(orgSlug: string, token: string | null | undefined) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const rows: any[] =
      (await this.t("customerAddress").findMany({
        where: { organizationId: org.id, customerId: customer.id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })) ?? [];
    return { items: rows.map((a) => this.serializeAddress(a)) };
  }

  private async unsetOtherDefaults(orgId: string, customerId: string, exceptId?: string): Promise<void> {
    try {
      const table = this.t("customerAddress");
      const rows: any[] =
        (await table.findMany({ where: { organizationId: orgId, customerId, isDefault: true } })) ?? [];
      for (const row of rows) {
        if (exceptId && row.id === exceptId) continue;
        await table.update({ where: { id: row.id }, data: { isDefault: false } });
      }
    } catch {
      /* default-flag bookkeeping */
    }
  }

  async createAddress(orgSlug: string, token: string | null | undefined, dto: CreateAddressDto) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const existing: any[] =
      (await this.t("customerAddress").findMany({
        where: { organizationId: org.id, customerId: customer.id },
      })) ?? [];
    const isDefault = dto.isDefault === true || existing.length === 0;
    if (isDefault) await this.unsetOtherDefaults(org.id, customer.id);
    const row = await this.t("customerAddress").create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        label: dto.label ?? null,
        recipientName: dto.recipientName.trim(),
        phone: dto.phone.trim(),
        addressLine: dto.addressLine.trim(),
        district: dto.district.trim(),
        isDefault,
      },
    });
    return this.serializeAddress(row);
  }

  private async requireOwnAddress(orgId: string, customerId: string, addressId: string): Promise<any> {
    const row = await this.t("customerAddress").findFirst({
      where: { id: addressId, organizationId: orgId, customerId },
    });
    if (!row) throw new NotFoundException("ঠিকানাটি পাওয়া যায়নি");
    return row;
  }

  async updateAddress(
    orgSlug: string,
    token: string | null | undefined,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const row = await this.requireOwnAddress(org.id, customer.id, addressId);
    const data: Record<string, any> = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.recipientName !== undefined) data.recipientName = dto.recipientName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.addressLine !== undefined) data.addressLine = dto.addressLine.trim();
    if (dto.district !== undefined) data.district = dto.district.trim();
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.isDefault === true) await this.unsetOtherDefaults(org.id, customer.id, row.id);
    const saved = await this.t("customerAddress").update({ where: { id: row.id }, data });
    return this.serializeAddress(saved ?? { ...row, ...data });
  }

  async deleteAddress(orgSlug: string, token: string | null | undefined, addressId: string) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const row = await this.requireOwnAddress(org.id, customer.id, addressId);
    const wasDefault = !!row.isDefault;
    await this.t("customerAddress").delete({ where: { id: row.id } });
    if (wasDefault) {
      // Promote the oldest remaining address so the customer
      // keeps a default (checkout prefill never goes empty while
      // addresses exist).
      const remaining: any[] =
        (await this.t("customerAddress").findMany({
          where: { organizationId: org.id, customerId: customer.id },
          orderBy: { createdAt: "asc" },
        })) ?? [];
      if (remaining[0]) {
        await this.t("customerAddress").update({
          where: { id: remaining[0].id },
          data: { isDefault: true },
        });
      }
    }
    return { deleted: true };
  }

  // ================= Orders =================

  private async orderItems(orderId: string): Promise<any[]> {
    try {
      const table = this.t("orderItem");
      if (!table?.findMany) return [];
      return (await table.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }).catch(() => [])) ?? [];
    } catch {
      return [];
    }
  }

  private serializeOrderSummary(order: any, items: any[]) {
    const placed = order.placedAt ?? order.createdAt ?? null;
    return {
      id: order.id,
      orderNumber: order.externalNumber ?? null,
      status: order.status,
      placedAt: placed ? new Date(placed).toISOString() : null,
      totalMinor: order.totalMinor != null ? String(order.totalMinor) : "0",
      itemCount: items.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
      items: items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        priceMinor: i.priceMinor != null ? String(i.priceMinor) : "0",
        totalMinor: i.totalMinor != null ? String(i.totalMinor) : "0",
        isGift: !!i.isGift,
      })),
      hasTracking: !["cancelled", "failed", "refunded"].includes(String(order.status)),
    };
  }

  async listOrders(
    orgSlug: string,
    token: string | null | undefined,
    pageRaw?: number,
    pageSizeRaw?: number,
  ) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const page = Math.max(1, Math.floor(Number(pageRaw) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSizeRaw) || 20)));
    const rows: any[] =
      (await this.t("order").findMany({
        where: { organizationId: org.id, customerId: customer.id },
      })) ?? [];
    const sorted = [...rows].sort((a, b) => {
      const at = new Date(a.placedAt ?? a.createdAt ?? 0).getTime();
      const bt = new Date(b.placedAt ?? b.createdAt ?? 0).getTime();
      return bt - at;
    });
    const total = sorted.length;
    const slice = sorted.slice((page - 1) * pageSize, page * pageSize);
    const items = [];
    for (const order of slice) {
      items.push(this.serializeOrderSummary(order, await this.orderItems(order.id)));
    }
    return {
      items,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  private async requireOwnOrder(orgId: string, customerId: string, orderId: string): Promise<any> {
    const order = await this.t("order").findFirst({
      where: { id: orderId, organizationId: orgId, customerId },
    });
    if (!order) throw new NotFoundException("অর্ডারটি পাওয়া যায়নি");
    return order;
  }

  async getOrder(orgSlug: string, token: string | null | undefined, orderId: string) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const order = await this.requireOwnOrder(org.id, customer.id, orderId);
    const items = await this.orderItems(order.id);
    const summary = this.serializeOrderSummary(order, items);
    return {
      ...summary,
      items: items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        priceMinor: i.priceMinor != null ? String(i.priceMinor) : "0",
        totalMinor: i.totalMinor != null ? String(i.totalMinor) : "0",
        isGift: !!i.isGift,
        bundleName: i.bundleName ?? null,
      })),
      subtotalMinor: order.subtotalMinor != null ? String(order.subtotalMinor) : "0",
      discountMinor: order.discountMinor != null ? String(order.discountMinor) : "0",
      shippingMinor: order.shippingMinor != null ? String(order.shippingMinor) : "0",
      deliveryMinor: order.shippingMinor != null ? String(order.shippingMinor) : "0",
      address: order.address ?? null,
      giftSkipped: !!order.giftSkipped,
    };
  }

  async reorder(orgSlug: string, token: string | null | undefined, orderId: string) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const order = await this.requireOwnOrder(org.id, customer.id, orderId);
    const items = await this.orderItems(order.id);
    const available: any[] = [];
    const unavailable: any[] = [];
    for (const item of items) {
      const name = item.name;
      if (!item.productId) {
        unavailable.push({ name, reason: "পণ্যটি এখন ক্যাটালগে নেই" });
        continue;
      }
      const product = await this.t("product")
        .findFirst({ where: { id: item.productId, organizationId: org.id } })
        .catch(() => null);
      if (!product || product.status !== "ACTIVE") {
        unavailable.push({ name, reason: "পণ্যটি আর পাওয়া যাচ্ছে না" });
        continue;
      }
      let variant: any = null;
      if (item.sku) {
        const variants: any[] =
          (await this.t("productVariant")
            .findMany({ where: { productId: product.id } })
            .catch(() => [])) ?? [];
        variant = variants.find((v) => v.sku && String(v.sku) === String(item.sku)) ?? null;
      }
      const stock = variant?.stockQuantity ?? product.stockQuantity;
      if (stock !== null && stock !== undefined && Number(stock) <= 0 && !product.preorderEnabled) {
        unavailable.push({ name, reason: "স্টক শেষ" });
        continue;
      }
      // A gift line reordered becomes a normal PAID line at the
      // CURRENT price — it is included like any other line.
      let quantity = Number(item.quantity ?? 1);
      if (stock !== null && stock !== undefined && Number(stock) > 0) {
        quantity = Math.min(quantity, Number(stock));
      }
      const unit = variant?.priceMinor != null ? variant.priceMinor : product.priceMinor;
      available.push({
        productId: product.id,
        variantId: variant?.id ?? null,
        variantSku: variant?.sku ?? null,
        name,
        quantity,
        currentPriceMinor: String(unit),
        available: true,
      });
    }
    return { items: available, unavailable };
  }

  // ================= Wishlist =================

  private async serializeWishlistItem(row: any, product: any) {
    const current = BigInt(product.priceMinor);
    let atAdd: bigint;
    try {
      atAdd = BigInt(row.priceAtAddMinor);
    } catch {
      atAdd = current;
    }
    return {
      productId: product.id,
      name: product.name,
      slug: product.slug ?? null,
      imageUrl: product.imageUrl ?? null,
      currentPriceMinor: current.toString(),
      priceAtAddMinor: atAdd.toString(),
      priceDropped: current < atAdd,
      stockState: stockStateOf(product.stockQuantity, product.lowStockThreshold),
      addedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  async listWishlist(orgSlug: string, token: string | null | undefined) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const rows: any[] =
      (await this.t("wishlistItem").findMany({
        where: { organizationId: org.id, customerId: customer.id },
        orderBy: { createdAt: "asc" },
      })) ?? [];
    const items = [];
    for (const row of rows) {
      const product = await this.t("product")
        .findFirst({ where: { id: row.productId, organizationId: org.id } })
        .catch(() => null);
      if (!product) continue; // gone products are excluded, never faked
      items.push(await this.serializeWishlistItem(row, product));
    }
    return { items };
  }

  async addWishlist(orgSlug: string, token: string | null | undefined, productId: string) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const product = await this.t("product").findFirst({
      where: { id: productId, organizationId: org.id },
    });
    if (!product || product.status !== "ACTIVE") {
      throw new NotFoundException("পণ্যটি পাওয়া যায়নি");
    }
    const existing = await this.t("wishlistItem").findFirst({
      where: { customerId: customer.id, productId: product.id },
    });
    if (existing) {
      // Idempotent re-add: the original price snapshot stands.
      return { item: await this.serializeWishlistItem(existing, product) };
    }
    const row = await this.t("wishlistItem").create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        productId: product.id,
        priceAtAddMinor: product.priceMinor,
      },
    });
    return { item: await this.serializeWishlistItem(row, product) };
  }

  async removeWishlist(orgSlug: string, token: string | null | undefined, productId: string) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const existing = await this.t("wishlistItem").findFirst({
      where: { organizationId: org.id, customerId: customer.id, productId },
    });
    if (!existing) return { removed: false };
    await this.t("wishlistItem").delete({ where: { id: existing.id } });
    return { removed: true };
  }

  /**
   * Merge a guest (localStorage) wishlist into the account.
   * added = rows newly created; skipped = ids that did not
   * resolve to an ACTIVE product of THIS org OR were already
   * on the wishlist (including duplicates inside the input).
   */
  async mergeWishlist(orgSlug: string, token: string | null | undefined, productIds: string[]) {
    const { org, customer } = await this.requireSessionCustomer(orgSlug, token);
    const ids = (Array.isArray(productIds) ? productIds : []).slice(0, 100);
    let added = 0;
    let skipped = 0;
    for (const productId of ids) {
      const product = await this.t("product")
        .findFirst({ where: { id: productId, organizationId: org.id } })
        .catch(() => null);
      if (!product || product.status !== "ACTIVE") {
        skipped++;
        continue;
      }
      const existing = await this.t("wishlistItem").findFirst({
        where: { customerId: customer.id, productId: product.id },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await this.t("wishlistItem").create({
        data: {
          organizationId: org.id,
          customerId: customer.id,
          productId: product.id,
          priceAtAddMinor: product.priceMinor,
        },
      });
      added++;
    }
    return { added, skipped };
  }
}
