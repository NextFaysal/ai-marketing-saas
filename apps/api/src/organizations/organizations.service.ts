import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { imageExtForContentType, mediaKeyFromCdnUrl, publicMediaUrl } from "../storage/media-url";
import { CreateOrganizationDto, InviteMemberDto, PlanChangeRequestDto, UpdateBrandingDto, UpdateBusinessProfileDto, UploadLogoDto } from "./organizations.dto";
import { MediaStore } from "../inbox/media-store";
import { PERMISSION_AREAS, PERMISSION_AREA_KEYS, PRESET_ROLE_PROFILES, effectiveAccess, findUnknownAreas, normalizeOverrides, presetProfile } from "../common/permission-catalog";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_KEYS } from "../common/agent-notify";
import { slugAvailability } from "../common/slug-availability";
import {
  PLATFORM_CUSTOM_DOMAIN_MESSAGE,
  isPlatformHostedDomain,
  normalizeCustomDomainInput,
} from "../common/custom-domain";
import { isValidTimezone, isValidWindows } from "../inbox/working-hours";
import { parseAiSchedule } from "../inbox/ai-schedule";
import { EmailProvider } from "../messaging/email.provider";
import { storageUsageForOrg } from "../common/storage-usage";
import { depositConfigOf } from "../fraud/deposit";
import { dhakaMonthStartUtc, todayDhakaKey } from "../common/plan-limit-checks";
import { Role } from "@repo/db";

const INVITABLE_ROLES: Role[] = ["ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"] as Role[];

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // RB4/RM5: hash-versioned CDN logos. Optional + last so every
    // positional spec construction keeps working; absent (or
    // local storage mode) the M59 logo behaviour is unchanged.
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly storageRegistry?: StorageRegistryService,
  ) {}

  /** TD1/TD2: the live availability check behind
   * GET /organizations/slug-available — the same decision create()
   * enforces, so the onboarding picker can never promise a name
   * the server would then refuse. */
  async checkSlugAvailability(rawSlug: unknown) {
    return slugAvailability(this.prisma as any, rawSlug);
  }

  async create(userId: string, dto: CreateOrganizationDto, ip?: string) {
    // TD1: server-side slug governance — format + reserved names
    // (code lists + SUPER-added platform-setting extras) refuse
    // with the Bengali reason; "taken" keeps its long-standing
    // Conflict behaviour and message.
    const availability = await slugAvailability(this.prisma as any, dto.slug);
    if (!availability.available) {
      if (availability.reason === "taken") throw new ConflictException("This slug is already taken");
      throw new BadRequestException(availability.message);
    }
    const org = await (this.prisma as any).$transaction(async (tx: any) => {
      const created = await tx.organization.create({
        data: {
          name: dto.name.trim(), slug: dto.slug,
          country: dto.country ?? "BD", timezone: dto.timezone ?? "Asia/Dhaka", currency: dto.currency ?? "BDT",
        },
      });
      await tx.membership.create({ data: { userId, organizationId: created.id, role: "OWNER", status: "ACTIVE" } });
      await tx.businessProfile.create({ data: { organizationId: created.id } });
      await tx.subscription.create({ data: { organizationId: created.id, plan: "FREE", status: "TRIALING" } });
      return created;
    });
    await this.audit.log({ organizationId: org.id, userId, action: "org.create", entityType: "Organization", entityId: org.id, ipAddress: ip });
    return { ...org, creditMinor: BigInt(org.creditMinor ?? 0).toString() };
  }

  async listMine(userId: string) {
    const memberships = await (this.prisma as any).membership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m: any) => ({ ...m.organization, creditMinor: BigInt(m.organization?.creditMinor ?? 0).toString(), myRole: m.role }));
  }

  async getOne(organizationId: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    return { ...org, creditMinor: BigInt(org.creditMinor ?? 0).toString() };
  }

  async listMembers(organizationId: string) {
    const members = await (this.prisma as any).membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    // GB6 (GC16): each row also carries its CustomRole (id +
    // name) from ONE extra findMany for the org's roles.
    let nameById = new Map<string, string>();
    try {
      const roles = (await (this.prisma as any).customRole?.findMany?.({
        where: { organizationId }, select: { id: true, name: true },
      })) ?? [];
      nameById = new Map((roles as any[]).map((r) => [r.id, r.name]));
    } catch { /* custom-role table unavailable — names stay null */ }
    return (members as any[]).map((m) => ({
      ...m,
      customRoleId: m.customRoleId ?? null,
      customRoleName: m.customRoleId ? (nameById.get(m.customRoleId) ?? null) : null,
    }));
  }

  /**
   * Milestone 1 limitation (documented): the invited person must already
   * have an account. Email-based pending invitations arrive in Milestone 2.
   */
  async invite(organizationId: string, actorId: string, dto: InviteMemberDto, ip?: string) {
    if (!INVITABLE_ROLES.includes(dto.role as Role)) {
      throw new BadRequestException("Role cannot be assigned through invitation");
    }
    const user = await (this.prisma as any).user.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
    if (!user) throw new BadRequestException("This person does not have an account yet. Ask them to register first.");
    const { orgLimitOverrides, orgPlan, planLimits } = await import("../common/platform-settings");
    const overrides = await orgLimitOverrides(this.prisma as any, organizationId);
    const mergedLimits = await planLimits(this.prisma as any);
    const seatLimit = overrides.seatLimit ?? mergedLimits[await orgPlan(this.prisma as any, organizationId)]?.seats ?? null;
    if (seatLimit != null) {
      const activeMembers = await (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } });
      if (activeMembers >= seatLimit) {
        throw new BadRequestException(`This organization's plan allows ${seatLimit} seats and all are in use. Remove a member or upgrade the plan.`);
      }
    }
    const existing = await (this.prisma as any).membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
    if (existing) throw new ConflictException("This person is already a member of this organization");
    const membership = await (this.prisma as any).membership.create({
      data: { userId: user.id, organizationId, role: dto.role, status: "ACTIVE" },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "org.invite", entityType: "Membership", entityId: membership.id, metadata: { invitedEmail: dto.email, role: dto.role }, ipAddress: ip });
    return membership;
  }

  // ---- Milestone 34 (Phase N1): tenant billing ----

  /** Everything the tenant billing page shows, assembled from real
   * rows only: the latest subscription, operator-set plan prices,
   * effective limits (override -> plan -> env baseline), current
   * usage counts and recorded payments. */
  async getBilling(organizationId: string) {
    const ps = await import("../common/platform-settings");
    const baseline = {
      aiDaily: Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200),
      broadcastCap: Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000),
    };
    const [sub, prices, limits, payments, seatsUsed, aiCallsToday, broadcasts30d, yearlyPrices, mergedPlanLimits] = await Promise.all([
      (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
      ps.planPrices(this.prisma as any),
      ps.effectiveLimits(this.prisma as any, organizationId, baseline),
      (this.prisma as any).saasPayment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }),
      (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } }),
      (this.prisma as any).aIUsageRecord.count({
        where: { organizationId, createdAt: { gte: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z") } },
      }),
      (this.prisma as any).broadcast.count({
        where: { organizationId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
      }),
      ps.planYearlyPrices(this.prisma as any),
      ps.planLimits(this.prisma as any),
    ]);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const pc = await import("../common/platform-config");
    await pc.ensurePlatformConfig(this.prisma as any).catch(() => null);
    // Billing Package B6: next-invoice preview — what the
    // renewal will actually ask for, computed from the same
    // price books + credit the checkout uses. A scheduled
    // change (B2) retargets the preview to the pending plan.
    const nextInvoice = (() => {
      if (!sub || !sub.currentPeriodEnd) return null;
      const cycle = String(sub.billingCycle ?? "monthly");
      const targetPlan = String(sub.pendingPlan ?? sub.plan);
      if (targetPlan === "FREE") {
        return { plan: "FREE", cycle, amountMinor: "0", creditAppliedMinor: "0", dueMinor: "0", dueDate: sub.currentPeriodEnd, scheduledChange: !!sub.pendingPlan };
      }
      const book = cycle === "yearly" ? yearlyPrices : prices;
      const amount = BigInt(book[targetPlan] ?? 0);
      const credit = BigInt(org?.creditMinor ?? 0);
      const applied = credit > amount ? amount : credit;
      return {
        plan: targetPlan, cycle,
        amountMinor: amount.toString(), creditAppliedMinor: applied.toString(),
        dueMinor: (amount - applied).toString(), dueDate: sub.currentPeriodEnd,
        scheduledChange: !!sub.pendingPlan,
      };
    })();
    // GC22 (GB9): plan resource usage vs the plan's resource
    // limits (null limit = unlimited). Every figure is a real
    // count/aggregate; any single read failure degrades that
    // metric to 0 rather than breaking the billing payload.
    const resourceLimits = await ps.planResourceLimits(this.prisma as any, organizationId).catch(() => null);
    const graceDays = await ps.billingGraceDays(this.prisma as any).catch(() => 3);
    const safeCount = async (fn: () => Promise<unknown>): Promise<number> => {
      try { const n = await fn(); return typeof n === "number" ? n : 0; } catch { return 0; }
    };
    const [productCount, ordersThisMonth, storage, apiRow] = await Promise.all([
      safeCount(() => (this.prisma as any).product.count({ where: { organizationId, status: { not: "ARCHIVED" } } })),
      safeCount(() => (this.prisma as any).order.count({ where: { organizationId, createdAt: { gte: dhakaMonthStartUtc() } } })),
      storageUsageForOrg(this.prisma as any, organizationId),
      (async () => {
        try {
          return await (this.prisma as any).apiUsageDaily?.findUnique?.({
            where: { organizationId_day: { organizationId, day: todayDhakaKey() } },
          });
        } catch { return null; }
      })(),
    ]);
    const resourceUsage = {
      products: { used: productCount, limit: resourceLimits?.productLimit ?? null },
      ordersThisMonth: { used: ordersThisMonth, limit: resourceLimits?.orderLimit ?? null },
      storage: { usedBytes: storage.storageBytes, assetCount: storage.assetCount, limitMb: resourceLimits?.storageLimitMb ?? null },
      apiToday: { used: typeof apiRow?.count === "number" ? apiRow.count : 0, limit: resourceLimits?.apiDailyLimit ?? null },
    };
    const pastDueGraceEndsAt = sub?.status === "PAST_DUE" && sub.currentPeriodEnd
      ? new Date(new Date(sub.currentPeriodEnd).getTime() + graceDays * 24 * 3600 * 1000)
      : null;
    return {
      nextInvoice,
      paused: !!sub?.pausedAt,
      pastDueGraceEndsAt,
      resourceUsage,
      subscription: sub
        ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, pendingPlan: sub.pendingPlan ?? null, billingCycle: sub.billingCycle ?? "monthly", priceMinor: String((sub.billingCycle === "yearly" ? yearlyPrices : prices)[sub.plan] ?? 0), currency: "BDT", pausedAt: sub.pausedAt ?? null }
        : null,
      // Milestone 39: credit balance + which gateways the
      // platform team has actually configured (buttons in the
      // UI follow these flags, never assumptions).
      creditMinor: BigInt(org?.creditMinor ?? 0).toString(),
      // Billing Package B4: auto-renew status (never the id).
      autoRenew: await (async () => {
        const row = await (this.prisma as any).autoRenewAgreement?.findUnique?.({ where: { organizationId } })?.catch?.(() => null) ?? null;
        return row ? { status: row.status, payerReference: row.payerReference, lastChargeAt: row.lastChargeAt ?? null, lastError: row.lastError ?? null } : null;
      })(),
      gateways: {
        sslcommerz: pc.effectiveSslcommerzConfig() !== null,
        bkash: pc.effectiveBkashConfig() !== null,
      },
      limits,
      usage: { seatsUsed, aiCallsToday, broadcasts30d },
      plans: ps.PLAN_TIERS.map((tier) => ({
        tier,
        priceMinor: String(prices[tier] ?? 0),
        yearlyPriceMinor: String(yearlyPrices[tier] ?? 0),
        currency: "BDT",
        limits: mergedPlanLimits[tier],
      })),
      payments: (payments ?? []).map((p: any) => ({
        id: p.id,
        amountMinor: String(p.amountMinor),
        refundedMinor: String(p.refundedMinor ?? 0),
        currency: p.currency,
        method: p.method,
        reference: p.reference ?? null,
        periodStart: p.periodStart ?? null,
        periodEnd: p.periodEnd ?? null,
        note: p.note ?? null,
        createdAt: p.createdAt,
      })),
    };
  }

  /** Plan changes are operator-approved until online subscription
   * payments land (Phase N1 item 2): the request is written as an
   * admin note on the organization + an audit entry, and the
   * platform team applies it from the Admin Console. */
  async requestPlanChange(organizationId: string, actorId: string, dto: PlanChangeRequestDto, ip?: string) {
    const ps = await import("../common/platform-settings");
    if (!(ps.PLAN_TIERS as readonly string[]).includes(dto.requestedPlan)) {
      throw new BadRequestException(`Unknown plan "${dto.requestedPlan}"`);
    }
    const current = await ps.orgPlan(this.prisma as any, organizationId);
    if (dto.requestedPlan === current) {
      throw new BadRequestException(`The organization is already on the ${current} plan`);
    }
    await (this.prisma as any).adminNote.create({
      data: {
        targetType: "organization",
        targetId: organizationId,
        body: `Plan change requested from the tenant billing page: ${current} -> ${dto.requestedPlan}.${dto.note ? ` Note: ${dto.note}` : ""}`,
        authorId: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.plan_change_requested", entityType: "Organization", entityId: organizationId,
      metadata: { from: current, to: dto.requestedPlan, note: dto.note ?? null }, ipAddress: ip,
    });
    return { ok: true, currentPlan: current, requestedPlan: dto.requestedPlan };
  }

  // ---- GC22 (GB9): subscription pause / resume ----
  // Pause stamps pausedAt on the org's LATEST subscription;
  // while set, the PlanLimit choke points refuse commerce
  // writes. Resume clears the stamp. Both are audited
  // (entitlement mutations). No subscription, or pausing a
  // CANCELLED one, is refused.

  async pauseSubscription(organizationId: string, actorId: string, ip?: string) {
    const sub = await (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    if (!sub) throw new BadRequestException("কোনো সাবস্ক্রিপশন পাওয়া যায়নি — pause করার মতো কিছু নেই।");
    if (sub.status === "CANCELLED") throw new BadRequestException("বাতিল হওয়া সাবস্ক্রিপশন pause করা যাবে না।");
    if (sub.pausedAt) return { ok: true, paused: true, pausedAt: sub.pausedAt };
    const pausedAt = new Date();
    await (this.prisma as any).subscription.update({ where: { id: sub.id }, data: { pausedAt } });
    await this.audit.log({
      organizationId, userId: actorId, action: "billing.subscription_paused", entityType: "Subscription", entityId: sub.id,
      metadata: { plan: sub.plan, status: sub.status }, ipAddress: ip,
    });
    return { ok: true, paused: true, pausedAt };
  }

  async resumeSubscription(organizationId: string, actorId: string, ip?: string) {
    const sub = await (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    if (!sub) throw new BadRequestException("কোনো সাবস্ক্রিপশন পাওয়া যায়নি — resume করার মতো কিছু নেই।");
    if (!sub.pausedAt) return { ok: true, paused: false, pausedAt: null };
    await (this.prisma as any).subscription.update({ where: { id: sub.id }, data: { pausedAt: null } });
    await this.audit.log({
      organizationId, userId: actorId, action: "billing.subscription_resumed", entityType: "Subscription", entityId: sub.id,
      metadata: { plan: sub.plan, status: sub.status }, ipAddress: ip,
    });
    return { ok: true, paused: false, pausedAt: null };
  }

  // ---- Milestone 34 (Phase N1): email member invitations ----

  private hashInviteToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private invitationStatus(inv: any): string {
    if (inv.status === "pending" && new Date(inv.expiresAt).getTime() < Date.now()) return "expired";
    return inv.status;
  }

  private invitationView(inv: any) {
    return {
      id: inv.id, email: inv.email, role: inv.role, status: this.invitationStatus(inv),
      expiresAt: inv.expiresAt, emailSent: inv.emailSent === true,
      acceptedAt: inv.acceptedAt ?? null, createdAt: inv.createdAt,
    };
  }

  private async seatGuard(organizationId: string, excludeInvitationId?: string) {
    const ps = await import("../common/platform-settings");
    const overrides = await ps.orgLimitOverrides(this.prisma as any, organizationId);
    const mergedLimits = await ps.planLimits(this.prisma as any);
    const seatLimit = overrides.seatLimit ?? mergedLimits[await ps.orgPlan(this.prisma as any, organizationId)]?.seats ?? null;
    if (seatLimit == null) return;
    const [members, pendingInvites] = await Promise.all([
      (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } }),
      (this.prisma as any).memberInvitation.count({
        where: {
          organizationId, status: "pending", expiresAt: { gt: new Date() },
          // When ACCEPTING, the invitation being accepted converts
          // into the membership — it must not count against itself
          // (live-found M34 bug: on the 2-seat FREE plan no emailed
          // invitation could ever be accepted).
          ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}),
        },
      }),
    ]);
    if (members + pendingInvites >= seatLimit) {
      throw new BadRequestException(`This organization's plan allows ${seatLimit} seats and all are in use (counting pending invitations). Remove a member, revoke an invitation, or upgrade the plan.`);
    }
  }

  private inviteUrl(rawToken: string): string {
    const base = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/accept-invite?token=${rawToken}`;
  }

  private async sendInvitationEmail(inv: any, rawToken: string): Promise<boolean> {
    try {
      const provider = new EmailProvider();
      if (!provider.isConfigured()) return false;
      const org = await (this.prisma as any).organization.findUnique({ where: { id: inv.organizationId } });
      const sent = await provider.send({
        to: inv.email,
        subject: `${org?.name ?? "একটি প্রতিষ্ঠান"} — টিমে যোগ দেওয়ার আমন্ত্রণ`,
        text: [
          `আপনাকে ${org?.name ?? "একটি প্রতিষ্ঠান"} এর টিমে ${inv.role} ভূমিকায় যোগ দিতে আমন্ত্রণ জানানো হয়েছে।`,
          `আমন্ত্রণ গ্রহণ করতে এই লিংকে যান (৭ দিন মেয়াদ):`,
          this.inviteUrl(rawToken),
          ``,
          `অ্যাকাউন্ট না থাকলে আগে ওই একই ইমেইল দিয়ে রেজিস্টার করে তারপর লিংকটি খুলুন।`,
          `এই আমন্ত্রণ প্রত্যাশা না করলে ইমেইলটি উপেক্ষা করুন।`,
        ].join("\n"),
      });
      return Boolean(sent?.providerMessageId);
    } catch {
      return false;
    }
  }

  async createEmailInvitation(organizationId: string, actorId: string, dto: InviteMemberDto, ip?: string) {
    if (!INVITABLE_ROLES.includes(dto.role as Role)) {
      throw new BadRequestException("Role cannot be assigned through invitation");
    }
    const email = dto.email.toLowerCase().trim();
    const existingUser = await (this.prisma as any).user.findUnique({ where: { email } });
    if (existingUser) {
      const membership = await (this.prisma as any).membership.findUnique({
        where: { userId_organizationId: { userId: existingUser.id, organizationId } },
      });
      if (membership) throw new ConflictException("This person is already a member of this organization");
    }
    const pending = await (this.prisma as any).memberInvitation.findFirst({
      where: { organizationId, email, status: "pending", expiresAt: { gt: new Date() } },
    });
    if (pending) throw new ConflictException("A pending invitation already exists for this email. Revoke or resend it instead.");
    await this.seatGuard(organizationId);
    const rawToken = randomBytes(24).toString("base64url");
    const inv = await (this.prisma as any).memberInvitation.create({
      data: {
        organizationId, email, role: dto.role, invitedById: actorId,
        tokenHash: this.hashInviteToken(rawToken),
        status: "pending", emailSent: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    const emailSent = await this.sendInvitationEmail(inv, rawToken);
    if (emailSent) {
      await (this.prisma as any).memberInvitation.update({ where: { id: inv.id }, data: { emailSent: true } });
      inv.emailSent = true;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "org.invite_email_created", entityType: "MemberInvitation", entityId: inv.id,
      metadata: { invitedEmail: email, role: dto.role, emailSent }, ipAddress: ip,
    });
    // The raw token is returned ONCE, to the inviting OWNER/ADMIN,
    // so they can also share the link manually when email is not
    // configured or did not go out.
    return { invitation: this.invitationView(inv), inviteUrl: this.inviteUrl(rawToken), emailSent };
  }

  async listInvitations(organizationId: string) {
    const rows = await (this.prisma as any).memberInvitation.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((inv: any) => this.invitationView(inv));
  }

  async revokeInvitation(organizationId: string, actorId: string, invitationId: string, ip?: string) {
    const inv = await (this.prisma as any).memberInvitation.findFirst({ where: { id: invitationId, organizationId } });
    if (!inv) throw new NotFoundException("Invitation not found");
    if (inv.status !== "pending") throw new BadRequestException(`Invitation is already ${inv.status}`);
    await (this.prisma as any).memberInvitation.update({ where: { id: inv.id }, data: { status: "revoked" } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.invite_revoked", entityType: "MemberInvitation", entityId: inv.id,
      metadata: { invitedEmail: inv.email }, ipAddress: ip,
    });
    return { ok: true };
  }

  async resendInvitation(organizationId: string, actorId: string, invitationId: string, ip?: string) {
    const inv = await (this.prisma as any).memberInvitation.findFirst({ where: { id: invitationId, organizationId } });
    if (!inv) throw new NotFoundException("Invitation not found");
    if (inv.status === "accepted") throw new BadRequestException("Invitation was already accepted");
    if (inv.status === "revoked") throw new BadRequestException("Invitation was revoked; create a new one instead");
    const rawToken = randomBytes(24).toString("base64url");
    const updated = await (this.prisma as any).memberInvitation.update({
      where: { id: inv.id },
      data: {
        tokenHash: this.hashInviteToken(rawToken), status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    const emailSent = await this.sendInvitationEmail(updated, rawToken);
    if (emailSent) {
      await (this.prisma as any).memberInvitation.update({ where: { id: inv.id }, data: { emailSent: true } });
      updated.emailSent = true;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "org.invite_resent", entityType: "MemberInvitation", entityId: inv.id,
      metadata: { invitedEmail: inv.email, emailSent }, ipAddress: ip,
    });
    return { invitation: this.invitationView(updated), inviteUrl: this.inviteUrl(rawToken), emailSent };
  }

  private async findInvitationByToken(rawToken: string) {
    const inv = await (this.prisma as any).memberInvitation.findUnique({
      where: { tokenHash: this.hashInviteToken(rawToken) },
    });
    if (!inv) throw new NotFoundException("Invitation not found or the link is invalid");
    return inv;
  }

  /** What the accept page shows the signed-in user. Email binding is
   * the security rule: only the account whose email matches the
   * invitation can accept it. */
  async getInvitationForUser(user: { userId: string; email: string }, rawToken: string) {
    const inv = await this.findInvitationByToken(rawToken);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: inv.organizationId } });
    return {
      organizationId: inv.organizationId,
      organizationName: org?.name ?? "",
      email: inv.email,
      role: inv.role,
      status: this.invitationStatus(inv),
      expiresAt: inv.expiresAt,
      emailMatchesAccount: user.email.toLowerCase().trim() === inv.email,
    };
  }

  async acceptInvitation(user: { userId: string; email: string }, rawToken: string, ip?: string) {
    const inv = await this.findInvitationByToken(rawToken);
    if (inv.status === "revoked") throw new BadRequestException("This invitation was revoked");
    if (inv.status === "accepted") throw new BadRequestException("This invitation was already used");
    if (this.invitationStatus(inv) === "expired") throw new BadRequestException("This invitation has expired. Ask the organization admin to resend it.");
    if (user.email.toLowerCase().trim() !== inv.email) {
      throw new ForbiddenException("This invitation was sent to a different email address. Sign in with the invited email to accept it.");
    }
    const existing = await (this.prisma as any).membership.findUnique({
      where: { userId_organizationId: { userId: user.userId, organizationId: inv.organizationId } },
    });
    if (existing) {
      // The invite achieved its purpose; close it out cleanly.
      await (this.prisma as any).memberInvitation.update({
        where: { id: inv.id },
        data: { status: "accepted", acceptedAt: new Date(), acceptedUserId: user.userId },
      });
      return { ok: true, alreadyMember: true, organizationId: inv.organizationId, role: existing.role };
    }
    await this.seatGuard(inv.organizationId, inv.id);
    const membership = await (this.prisma as any).membership.create({
      data: { userId: user.userId, organizationId: inv.organizationId, role: inv.role, status: "ACTIVE" },
    });
    await (this.prisma as any).memberInvitation.update({
      where: { id: inv.id },
      data: { status: "accepted", acceptedAt: new Date(), acceptedUserId: user.userId },
    });
    await this.audit.log({
      organizationId: inv.organizationId, userId: user.userId, action: "org.invite_accepted", entityType: "MemberInvitation", entityId: inv.id,
      metadata: { invitedEmail: inv.email, role: inv.role }, ipAddress: ip,
    });
    return { ok: true, alreadyMember: false, organizationId: inv.organizationId, role: membership.role };
  }

  // ---- Milestone 35 (Phase N1): onboarding state + member TOTP reset ----

  /** Onboarding checklist computed ONLY from real rows: a step is
   * done when the underlying data actually exists. */
  async getOnboarding(organizationId: string) {
    const count = async (table: string): Promise<number> => {
      try { return (await (this.prisma as any)[table]?.count?.({ where: { organizationId } })) ?? 0; }
      catch { return 0; }
    };
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null);
    const [stores, integrations, products, adAccounts, members, campaigns] = await Promise.all([
      count("store"), count("integration"), count("product"), count("adAccount"),
      (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } }),
      count("campaignPlan"),
    ]);
    const steps = [
      { key: "profile", label: "ব্যবসার প্রোফাইল পূরণ করুন", done: Boolean(profile && (profile.description || profile.websiteUrl || profile.industry)), href: "/dashboard/knowledge" },
      { key: "store", label: "স্টোর কানেক্ট করুন (WooCommerce / Shopify)", done: stores > 0, href: "/dashboard/integrations" },
      { key: "products", label: "প্রোডাক্ট সিঙ্ক করুন", done: products > 0, href: "/dashboard/products" },
      { key: "integration", label: "ইন্টিগ্রেশন যাচাই করুন (স্টোর / মেসেজিং)", done: integrations > 0, href: "/dashboard/integrations" },
      { key: "meta", label: "বিজ্ঞাপন অ্যাকাউন্ট কানেক্ট করুন", done: adAccounts > 0, href: "/dashboard/ad-accounts" },
      { key: "team", label: "টিম সদস্য আমন্ত্রণ জানান", done: members > 1, href: "/dashboard/team" },
      { key: "campaign", label: "প্রথম ক্যাম্পেইন ড্রাফট বানান", done: campaigns > 0, href: "/dashboard/campaign-builder" },
    ];
    const completed = steps.filter((s) => s.done).length;
    return { steps, completed, total: steps.length, allDone: completed === steps.length };
  }

  // ---- CX12a: Setup Guide ----
  // The guided setup experience. Same honesty rule as
  // getOnboarding above: a step is done ONLY when the underlying
  // real rows/state exist — nothing is inferred or faked.
  // Reused checkers (identical state source + semantics as
  // getOnboarding): profile, store, products, team.
  // New checkers: channel (a CONNECTED messaging integration),
  // instructions (a CX2 AiInstructionVersion exists — published,
  // not merely typed into the live field), courier (a CONNECTED
  // steadfast/pathao/redx integration), ai_schedule (CX12d:
  // InboxSetting.aiScheduleByChannel has at least one channel
  // entry with enabled=true).
  async getSetupGuide(organizationId: string) {
    const count = async (table: string, extra: Record<string, unknown> = {}): Promise<number> => {
      try { return (await (this.prisma as any)[table]?.count?.({ where: { organizationId, ...extra } })) ?? 0; }
      catch { return 0; }
    };
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null);
    const inboxSetting = await (this.prisma as any).inboxSetting?.findUnique?.({ where: { organizationId } }).catch(() => null);
    let scheduleSet = false;
    try {
      const schedule = parseAiSchedule(inboxSetting?.aiScheduleByChannel ?? null);
      scheduleSet = Object.values(schedule).some((entry: any) => entry?.enabled === true);
    } catch { scheduleSet = false; }
    const [channelIntegrations, stores, products, instructionVersions, courierIntegrations, members] = await Promise.all([
      count("integration", { provider: { in: ["whatsapp", "messenger", "instagram", "telegram", "email"] }, status: "CONNECTED" }),
      count("store"),
      count("product"),
      count("aiInstructionVersion"),
      count("integration", { provider: { in: ["steadfast", "pathao", "redx"] }, status: "CONNECTED" }),
      (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } }).catch(() => 0),
    ]);
    const steps = [
      { key: "profile", label: "ব্যবসার প্রোফাইল পূরণ করুন", done: Boolean(profile && (profile.description || profile.websiteUrl || profile.industry)), href: "/dashboard/knowledge" },
      { key: "channel", label: "মেসেজিং চ্যানেল কানেক্ট করুন (WhatsApp / Messenger)", done: channelIntegrations > 0, href: "/dashboard/integrations" },
      { key: "store", label: "স্টোর কানেক্ট করুন (WooCommerce / Shopify)", done: stores > 0, href: "/dashboard/integrations" },
      { key: "products", label: "প্রোডাক্ট যোগ করুন", done: products > 0, href: "/dashboard/products" },
      { key: "instructions", label: "AI নির্দেশনা প্রকাশ (Publish) করুন", done: instructionVersions > 0, href: "/dashboard/ai-instructions" },
      { key: "courier", label: "কুরিয়ার কনফিগার করুন (Steadfast / Pathao / RedX)", done: courierIntegrations > 0, href: "/dashboard/integrations" },
      { key: "team", label: "টিম সদস্য আমন্ত্রণ জানান", done: members > 1, href: "/dashboard/team" },
      { key: "ai_schedule", label: "AI-এর সময়সূচি সেট করুন", done: scheduleSet, href: "/dashboard/inbox" },
    ];
    const completed = steps.filter((s) => s.done).length;
    const total = steps.length;
    return {
      steps, completed, total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      allDone: completed === total,
    };
  }

  /** Recovery for a member who lost their authenticator: the org
   * OWNER (only) can clear the member's TOTP. Audited; the member
   * re-enrols themselves afterwards. */
  async resetMemberTotp(organizationId: string, actorId: string, targetUserId: string, ip?: string) {
    const membership = await (this.prisma as any).membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    });
    if (!membership) throw new NotFoundException("That user is not a member of this organization");
    const target = await (this.prisma as any).user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException("User not found");
    if (!target.totpEnabled && !target.totpSecretEncrypted) {
      throw new BadRequestException("This member does not have two-factor authentication set up");
    }
    await (this.prisma as any).user.update({
      where: { id: targetUserId },
      data: { totpEnabled: false, totpSecretEncrypted: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.member_totp_reset", entityType: "User", entityId: targetUserId,
      metadata: { memberEmail: target.email }, ipAddress: ip,
    });
    return { ok: true, userId: targetUserId, totpEnabled: false };
  }

  // ---------- Milestone 67 (Team T1): member lifecycle ----------

  private async memberOrThrow(organizationId: string, targetUserId: string) {
    const membership = await (this.prisma as any).membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!membership) throw new NotFoundException("That user is not a member of this organization");
    return membership;
  }

  /** Open conversations must never be stranded on a person who
   * can no longer work them: hand them back to the pool
   * (unassigned) so the assignment sweep redistributes them. */
  private async handOverOpenConversations(organizationId: string, userId: string): Promise<number> {
    const out = await (this.prisma as any).channelConversation.updateMany({
      where: { organizationId, assignedUserId: userId, status: "open" },
      data: { assignedUserId: null },
    }).catch(() => ({ count: 0 }));
    return out?.count ?? 0;
  }

  async updateMemberRole(organizationId: string, actorId: string, targetUserId: string, role: string, ip?: string) {
    if (!INVITABLE_ROLES.includes(role as Role)) {
      throw new BadRequestException("This role cannot be assigned (OWNER is never assignable here)");
    }
    const membership = await this.memberOrThrow(organizationId, targetUserId);
    if (membership.role === "OWNER") throw new BadRequestException("The organization owner's role cannot be changed");
    if (membership.role === role) return { ok: true, userId: targetUserId, role, unchanged: true };
    const from = membership.role;
    const updated = await (this.prisma as any).membership.update({
      where: { id: membership.id }, data: { role },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.member_role_updated", entityType: "Membership", entityId: membership.id,
      metadata: { targetUserId, memberEmail: membership.user?.email, from, to: role }, ipAddress: ip,
    });
    return { ok: true, userId: targetUserId, role: updated.role, from };
  }

  async setMemberStatus(organizationId: string, actorId: string, targetUserId: string, status: string, ip?: string) {
    if (status !== "SUSPENDED" && status !== "ACTIVE") throw new BadRequestException("Status must be SUSPENDED or ACTIVE");
    const membership = await this.memberOrThrow(organizationId, targetUserId);
    if (membership.role === "OWNER") throw new BadRequestException("The organization owner cannot be suspended");
    if (targetUserId === actorId) throw new BadRequestException("You cannot change your own status");
    if (membership.status === status) return { ok: true, userId: targetUserId, status, unchanged: true };
    let handedOver = 0;
    if (status === "SUSPENDED") {
      handedOver = await this.handOverOpenConversations(organizationId, targetUserId);
      // The board must not show a suspended agent as available.
      await (this.prisma as any).agentState.updateMany({
        where: { organizationId, userId: targetUserId }, data: { status: "away" },
      }).catch(() => undefined);
    }
    await (this.prisma as any).membership.update({ where: { id: membership.id }, data: { status } });
    await this.audit.log({
      organizationId, userId: actorId,
      action: status === "SUSPENDED" ? "org.member_suspended" : "org.member_reactivated",
      entityType: "Membership", entityId: membership.id,
      metadata: { targetUserId, memberEmail: membership.user?.email, handedOver }, ipAddress: ip,
    });
    return { ok: true, userId: targetUserId, status, handedOver };
  }

  async removeMember(organizationId: string, actorId: string, targetUserId: string, ip?: string) {
    const membership = await this.memberOrThrow(organizationId, targetUserId);
    if (membership.role === "OWNER") throw new BadRequestException("The organization owner cannot be removed");
    if (targetUserId === actorId) throw new BadRequestException("You cannot remove yourself");
    const handedOver = await this.handOverOpenConversations(organizationId, targetUserId);
    // Leave no roster residue: inbox teams + agent state go too.
    const teams = await (this.prisma as any).inboxTeam.findMany({
      where: { organizationId }, select: { id: true },
    }).catch(() => []);
    if (teams.length) {
      await (this.prisma as any).inboxTeamMember.deleteMany({
        where: { userId: targetUserId, teamId: { in: teams.map((t: any) => t.id) } },
      }).catch(() => undefined);
    }
    await (this.prisma as any).agentState.deleteMany({
      where: { organizationId, userId: targetUserId },
    }).catch(() => undefined);
    await (this.prisma as any).membership.delete({ where: { id: membership.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.member_removed", entityType: "Membership", entityId: membership.id,
      metadata: { targetUserId, memberEmail: membership.user?.email, role: membership.role, handedOver }, ipAddress: ip,
    });
    return { ok: true, userId: targetUserId, removed: true, handedOver };
  }

  // ---------- Milestone 72 (Team W3): custom access ----------

  /** The permission catalog (for the access editor). */
  accessCatalog() {
    return PERMISSION_AREAS;
  }

  /** A member's access picture: role, stored overrides and the
   * computed effective access. Managers see anyone; a member
   * may view only their own. */
  async getMemberAccess(organizationId: string, actorId: string, targetUserId: string) {
    const p = this.prisma as any;
    const actor = await p.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
    });
    if (!actor || actor.status !== "ACTIVE") throw new NotFoundException("Actor is not an active member of this organization");
    const isManager = ["OWNER", "ADMIN"].includes(actor.role);
    if (!isManager && actorId !== targetUserId) throw new ForbiddenException("You can only view your own access");
    const target = await p.membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    });
    if (!target) throw new NotFoundException("That user is not a member of this organization");
    const overrides = normalizeOverrides(target.permissionOverrides);
    const customRole = await this.customRoleOf(organizationId, target);
    return {
      userId: targetUserId, role: target.role,
      overrides,
      customRole,
      effective: effectiveAccess(target.role, target.permissionOverrides, customRole ? customRole.areas : undefined),
    };
  }

  /** GB6 (GC16): the member's CustomRole in this org (areas
   * filtered to known catalog keys), or null. Defensive: any
   * lookup failure reads as "no custom role". */
  private async customRoleOf(organizationId: string, membership: any) {
    if (!membership?.customRoleId) return null;
    try {
      const row = await (this.prisma as any).customRole?.findUnique?.({ where: { id: membership.customRoleId } });
      if (!row || row.organizationId !== organizationId) return null;
      const areas = Array.isArray(row.areas)
        ? row.areas.filter((k: unknown): k is string => typeof k === "string" && PERMISSION_AREA_KEYS.includes(k))
        : [];
      return { id: row.id, name: row.name, areas, presetKey: row.presetKey ?? null };
    } catch { return null; }
  }

  /** Replace a member's overrides (OWNER/ADMIN only — enforced
   * at the controller). The OWNER's own access can never be
   * overridden. Every change is audited with its diff. */
  async updateMemberAccess(organizationId: string, actorId: string, targetUserId: string, dto: { grants?: string[]; denies?: string[] }, ip?: string) {
    const unknown = findUnknownAreas(dto);
    if (unknown.length) throw new BadRequestException(`Unknown permission areas: ${unknown.join(", ")}`);
    const p = this.prisma as any;
    const target = await p.membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    });
    if (!target) throw new NotFoundException("That user is not a member of this organization");
    if (target.role === "OWNER") throw new BadRequestException("The owner's access cannot be customized — the owner always has full access");
    const before = normalizeOverrides(target.permissionOverrides);
    const after = normalizeOverrides(dto);
    const diff = {
      grantsAdded: after.grants.filter((g) => !before.grants.includes(g)),
      grantsRemoved: before.grants.filter((g) => !after.grants.includes(g)),
      deniesAdded: after.denies.filter((d) => !before.denies.includes(d)),
      deniesRemoved: before.denies.filter((d) => !after.denies.includes(d)),
    };
    await p.membership.update({ where: { id: target.id }, data: { permissionOverrides: after } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.member_access_updated",
      entityType: "Membership", entityId: target.id,
      metadata: { targetUserId, ...diff, grants: after.grants, denies: after.denies },
      ipAddress: ip,
    });
    return this.getMemberAccess(organizationId, actorId, targetUserId);
  }

  // ---------- GB6 (GC16): custom roles (named area bundles) ----------

  private validateCustomRoleName(raw: unknown): string {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name.length < 1 || name.length > 60) {
      throw new BadRequestException("Custom role name must be 1–60 characters");
    }
    return name;
  }

  private validateCustomRoleAreas(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException("A custom role needs at least one permission area");
    }
    const unknown = raw.filter((k) => typeof k !== "string" || !PERMISSION_AREA_KEYS.includes(k as string)).map((k) => String(k));
    if (unknown.length) throw new BadRequestException(`Unknown permission areas: ${unknown.join(", ")}`);
    return [...new Set(raw as string[])];
  }

  private async customRoleMemberCount(organizationId: string, roleId: string): Promise<number> {
    try {
      return (await (this.prisma as any).membership.count({ where: { organizationId, customRoleId: roleId } })) ?? 0;
    } catch { return 0; }
  }

  private async customRoleView(organizationId: string, row: any) {
    return {
      id: row.id, name: row.name,
      areas: Array.isArray(row.areas) ? row.areas : [],
      presetKey: row.presetKey ?? null,
      memberCount: await this.customRoleMemberCount(organizationId, row.id),
    };
  }

  private isUniqueViolation(e: unknown): boolean {
    return (e as any)?.code === "P2002";
  }

  /** The org's custom roles + the platform preset profiles a
   * new role can be materialized from. */
  async listCustomRoles(organizationId: string) {
    const rows = await (this.prisma as any).customRole.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    const roles = [];
    for (const row of rows as any[]) roles.push(await this.customRoleView(organizationId, row));
    return { roles, presetProfiles: PRESET_ROLE_PROFILES };
  }

  /** Create a custom role — either free-form (name + areas) or
   * from a preset profile (presetKey ALONE: an explicit name or
   * areas alongside it is rejected so the request can never be
   * ambiguous about which source won). Name is unique per org. */
  async createCustomRole(organizationId: string, actorId: string, dto: { name?: string; areas?: string[]; presetKey?: string }, ip?: string) {
    const p = this.prisma as any;
    let name: string; let areas: string[]; let presetKey: string | null = null;
    if (dto.presetKey != null && dto.presetKey !== "") {
      if (dto.name !== undefined || dto.areas !== undefined) {
        throw new BadRequestException("When presetKey is given, the name and areas come from the preset profile — send presetKey on its own");
      }
      const profile = presetProfile(dto.presetKey);
      if (!profile) throw new BadRequestException(`Unknown preset role profile: ${dto.presetKey}`);
      name = profile.label; areas = [...profile.areas]; presetKey = profile.key;
    } else {
      name = this.validateCustomRoleName(dto.name);
      areas = this.validateCustomRoleAreas(dto.areas);
    }
    const existing = await p.customRole.findFirst({ where: { organizationId, name } });
    if (existing) throw new BadRequestException(`A custom role named "${name}" already exists in this organization`);
    let row: any;
    try {
      row = await p.customRole.create({ data: { organizationId, name, areas, presetKey } });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new BadRequestException(`A custom role named "${name}" already exists in this organization`);
      }
      throw e;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "org.custom_role_created",
      entityType: "CustomRole", entityId: row.id,
      metadata: { name, areas }, ipAddress: ip,
    });
    return this.customRoleView(organizationId, row);
  }

  /** Rename / re-scope a custom role. presetKey is immutable —
   * it records where the role came from; sending it is ignored. */
  async updateCustomRole(organizationId: string, actorId: string, roleId: string, dto: { name?: string; areas?: string[] }, ip?: string) {
    const p = this.prisma as any;
    const row = await p.customRole.findFirst({ where: { id: roleId, organizationId } });
    if (!row) throw new NotFoundException("Custom role not found in this organization");
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = this.validateCustomRoleName(dto.name);
    if (dto.areas !== undefined) data.areas = this.validateCustomRoleAreas(dto.areas);
    if (Object.keys(data).length === 0) return this.customRoleView(organizationId, row);
    if (typeof data.name === "string" && data.name !== row.name) {
      const clash = await p.customRole.findFirst({ where: { organizationId, name: data.name } });
      if (clash) throw new BadRequestException(`A custom role named "${data.name}" already exists in this organization`);
    }
    let updated: any;
    try {
      updated = await p.customRole.update({ where: { id: row.id }, data });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new BadRequestException(`A custom role named "${String(data.name ?? row.name)}" already exists in this organization`);
      }
      throw e;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "org.custom_role_updated",
      entityType: "CustomRole", entityId: row.id,
      metadata: { name: updated.name, areas: Array.isArray(updated.areas) ? updated.areas : [] }, ipAddress: ip,
    });
    return this.customRoleView(organizationId, updated);
  }

  /** Deleting a role that members still use is refused — the
   * manager unassigns it first, so nobody's access changes
   * silently under them. */
  async deleteCustomRole(organizationId: string, actorId: string, roleId: string, ip?: string) {
    const p = this.prisma as any;
    const row = await p.customRole.findFirst({ where: { id: roleId, organizationId } });
    if (!row) throw new NotFoundException("Custom role not found in this organization");
    const inUse = await this.customRoleMemberCount(organizationId, roleId);
    if (inUse > 0) {
      throw new BadRequestException(`This custom role is assigned to ${inUse} member(s) — unassign it from them before deleting`);
    }
    await p.customRole.delete({ where: { id: row.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.custom_role_deleted",
      entityType: "CustomRole", entityId: row.id,
      metadata: { name: row.name, areas: Array.isArray(row.areas) ? row.areas : [] }, ipAddress: ip,
    });
    return { ok: true, deleted: true, id: row.id };
  }

  /** Assign (or clear, with null) a member's custom role. The
   * role must belong to THIS org; the OWNER's access can never
   * be customized. Returns the member's full access picture. */
  async assignMemberCustomRole(organizationId: string, actorId: string, targetUserId: string, dto: { customRoleId?: string | null }, ip?: string) {
    const p = this.prisma as any;
    const membership = await this.memberOrThrow(organizationId, targetUserId);
    if (membership.role === "OWNER") {
      throw new BadRequestException("The owner's access cannot be customized — the owner always has full access");
    }
    let roleRow: any = null;
    const customRoleId = dto.customRoleId ?? null;
    if (customRoleId !== null) {
      roleRow = await p.customRole.findFirst({ where: { id: customRoleId, organizationId } });
      if (!roleRow) throw new NotFoundException("Custom role not found in this organization");
    }
    await p.membership.update({ where: { id: membership.id }, data: { customRoleId } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org.member_custom_role_updated",
      entityType: "Membership", entityId: membership.id,
      metadata: { targetUserId, customRoleId: roleRow?.id ?? null, customRoleName: roleRow?.name ?? null },
      ipAddress: ip,
    });
    return this.getMemberAccess(organizationId, actorId, targetUserId);
  }

  // ---------- GB6 (GC16): member login history + sessions ----------
  // NOTE on scope: LoginEvents and UserSessions are per USER,
  // not per org — an account is global across organizations, so
  // a member's history/sessions shown here are their account's,
  // full stop. The manager's authority to see them comes from
  // the target being a member of THIS org (memberOrThrow);
  // there is no per-org slice of a session to show.

  async getMemberLoginHistory(organizationId: string, targetUserId: string) {
    await this.memberOrThrow(organizationId, targetUserId);
    try {
      const rows = (await (this.prisma as any).loginEvent?.findMany?.({
        where: { userId: targetUserId }, orderBy: { createdAt: "desc" }, take: 50,
      })) ?? [];
      return (rows as any[]).map((r) => ({
        id: r.id, email: r.email, success: r.success === true,
        ip: r.ip ?? null, userAgent: r.userAgent ?? null, createdAt: r.createdAt,
      }));
    } catch { return []; }
  }

  async getMemberSessions(organizationId: string, targetUserId: string) {
    await this.memberOrThrow(organizationId, targetUserId);
    try {
      const rows = (await (this.prisma as any).userSession?.findMany?.({
        where: { userId: targetUserId, revokedAt: null }, orderBy: { createdAt: "desc" },
      })) ?? [];
      return (rows as any[]).map((s) => ({
        id: s.id, ip: s.ip ?? null, userAgent: s.userAgent ?? null,
        createdAt: s.createdAt, lastSeenAt: s.lastSeenAt,
      }));
    } catch { return []; }
  }

  async revokeMemberSession(organizationId: string, actorId: string, targetUserId: string, sessionId: string, ip?: string) {
    await this.memberOrThrow(organizationId, targetUserId);
    let session: any = null;
    try {
      session = await (this.prisma as any).userSession?.findFirst?.({
        where: { id: sessionId, userId: targetUserId },
      });
    } catch { session = null; }
    if (!session) throw new NotFoundException("Session not found for this member");
    const alreadyRevoked = Boolean(session.revokedAt);
    if (!alreadyRevoked) {
      await (this.prisma as any).userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await this.audit.log({
        organizationId, userId: actorId, action: "org.member_session_revoked",
        entityType: "UserSession", entityId: session.id,
        metadata: { targetUserId }, ipAddress: ip,
      });
    }
    return { ok: true, id: session.id, alreadyRevoked };
  }

  async revokeAllMemberSessions(organizationId: string, actorId: string, targetUserId: string, ip?: string) {
    await this.memberOrThrow(organizationId, targetUserId);
    let count = 0;
    try {
      const out = await (this.prisma as any).userSession?.updateMany?.({
        where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() },
      });
      count = out?.count ?? 0;
    } catch { count = 0; }
    await this.audit.log({
      organizationId, userId: actorId, action: "org.member_sessions_revoked_all",
      entityType: "User", entityId: targetUserId,
      metadata: { targetUserId, count }, ipAddress: ip,
    });
    return { ok: true, revokedCount: count };
  }

  // ---------- GB6 (GC16): own notification preferences ----------

  /** The caller's notification preferences in this org: the
   * full category catalog + which categories they muted. */
  async getMyNotificationPreferences(organizationId: string, userId: string) {
    let mutedCategories: string[] = [];
    try {
      const pref = await (this.prisma as any).notificationPreference?.findUnique?.({
        where: { userId_organizationId: { userId, organizationId } },
      });
      if (Array.isArray(pref?.mutedCategories)) {
        mutedCategories = pref.mutedCategories.filter(
          (k: unknown): k is string => typeof k === "string" && NOTIFICATION_CATEGORY_KEYS.includes(k),
        );
      }
    } catch { mutedCategories = []; }
    return { categories: NOTIFICATION_CATEGORIES, mutedCategories };
  }

  async updateMyNotificationPreferences(organizationId: string, userId: string, dto: { mutedCategories?: string[] }, ip?: string) {
    if (!Array.isArray(dto?.mutedCategories)) {
      throw new BadRequestException("mutedCategories must be an array of notification category keys");
    }
    const unknown = dto.mutedCategories
      .filter((k) => typeof k !== "string" || !NOTIFICATION_CATEGORY_KEYS.includes(k as string))
      .map((k) => String(k));
    if (unknown.length) throw new BadRequestException(`Unknown notification categories: ${unknown.join(", ")}`);
    const mutedCategories = [...new Set(dto.mutedCategories)];
    await (this.prisma as any).notificationPreference.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { mutedCategories },
      create: { userId, organizationId, mutedCategories },
    });
    await this.audit.log({
      organizationId, userId, action: "org.notification_preferences_updated",
      entityType: "NotificationPreference", entityId: userId,
      metadata: { count: mutedCategories.length }, ipAddress: ip,
    });
    return this.getMyNotificationPreferences(organizationId, userId);
  }

  /** Milestone 69 (Team W1): the member activity feed — real
   * AuditLog rows for this org, newest first. Managers
   * (OWNER/ADMIN/MARKETING_MANAGER) see everyone; anyone else
   * only ever sees their own rows. */
  async memberActivityFeed(organizationId: string, actorId: string, query: { take?: number; userId?: string }) {
    const p = this.prisma as any;
    const actor = await p.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
    });
    if (!actor || actor.status !== "ACTIVE") throw new NotFoundException("Actor is not an active member of this organization");
    const isManager = ["OWNER", "ADMIN", "MARKETING_MANAGER"].includes(actor.role);
    const userId = isManager ? query.userId : actorId;
    const take = Math.min(100, Math.max(1, Math.round(Number(query.take ?? 30)) || 30));
    const rows = await p.auditLog.findMany({
      where: { organizationId, ...(userId ? { userId } : {}) },
      orderBy: { createdAt: "desc" },
      take,
    });
    const members = await p.membership.findMany({ where: { organizationId }, include: { user: true }, take: 200 });
    const nameOf = new Map((members as any[]).map((m) => [m.userId, m.user?.name ?? m.user?.email ?? m.userId]));
    return (rows as any[]).map((r) => ({
      id: r.id,
      userId: r.userId,
      actorName: r.userId ? nameOf.get(r.userId) ?? r.userId : "সিস্টেম",
      action: r.action,
      entityType: r.entityType,
      createdAt: r.createdAt,
    }));
  }

  /** Seat picture for the Team page: the plan limit (admin
   * override → plan → unlimited), how many seats are actually
   * used, and how many live invitations are holding one. */
  async seatUsage(organizationId: string) {
    const ps = await import("../common/platform-settings");
    const overrides = await ps.orgLimitOverrides(this.prisma as any, organizationId);
    const mergedLimits = await ps.planLimits(this.prisma as any);
    const limit = overrides.seatLimit ?? mergedLimits[await ps.orgPlan(this.prisma as any, organizationId)]?.seats ?? null;
    const [activeMembers, suspendedMembers, pendingInvites] = await Promise.all([
      (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } }),
      (this.prisma as any).membership.count({ where: { organizationId, status: "SUSPENDED" } }),
      (this.prisma as any).memberInvitation.count({
        where: { organizationId, status: "pending", expiresAt: { gt: new Date() } },
      }),
    ]);
    return {
      limit,
      activeMembers, suspendedMembers, pendingInvites,
      available: limit == null ? null : Math.max(0, limit - activeMembers - pendingInvites),
    };
  }

  async getBusinessProfile(organizationId: string) {
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } });
    return OrganizationsService.profileJson(profile);
  }

  /**
   * GC21 (GB9): merchant verification submit. Everything the
   * reviewer needs must already be on record — the org name, a
   * business address (profile.address or the dedicated
   * businessAddress), a contact channel (phone or email) and the
   * trade licence number. Missing pieces come back as a 400
   * naming each one in Bengali so the merchant can fix them in
   * one pass. Submit is allowed from unverified / rejected /
   * pending (a re-submit refreshes the stamp and clears the old
   * admin note); a verified org cannot re-enter the queue.
   */
  async submitVerification(organizationId: string, actorId: string, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    if (org.verificationStatus === "verified") {
      throw new BadRequestException("এই প্রতিষ্ঠানটি ইতিমধ্যে যাচাইকৃত — আবার জমা দেওয়ার দরকার নেই");
    }
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null);
    const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
    const missing: string[] = [];
    if (!has(org.name)) missing.push("প্রতিষ্ঠানের নাম");
    if (!has(profile?.address) && !has(profile?.businessAddress)) missing.push("ব্যবসার ঠিকানা");
    if (!has(profile?.contactPhone) && !has(profile?.contactEmail)) missing.push("যোগাযোগের ফোন বা ইমেইল");
    if (!has(profile?.tradeLicenseNo)) missing.push("ট্রেড লাইসেন্স নম্বর");
    if (missing.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: `যাচাইয়ের জন্য জমা দিতে আরও তথ্য লাগবে: ${missing.join(", ")} — Business Profile এ এগুলো পূরণ করে আবার জমা দিন।`,
        missing,
        error: "Bad Request",
      } as any);
    }
    const updated = await (this.prisma as any).organization.update({
      where: { id: organizationId },
      data: { verificationStatus: "pending", verificationSubmittedAt: new Date(), verificationNote: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "org.verification.submit", entityType: "Organization", entityId: organizationId, ipAddress: ip });
    return {
      ...updated,
      creditMinor: BigInt(updated.creditMinor ?? 0).toString(),
      verificationStatus: updated.verificationStatus,
      verificationNote: updated.verificationNote ?? null,
      verificationSubmittedAt: updated.verificationSubmittedAt ?? null,
    };
  }

  /** GC21 (GB9): recorded storage usage (MediaAsset registry
   * only — see common/storage-usage for the honesty contract). */
  async storageUsage(organizationId: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId }, select: { id: true } }).catch(() => null);
    if (!org) throw new NotFoundException("Organization not found");
    return storageUsageForOrg(this.prisma as any, organizationId);
  }

  /** BigInt money fields cannot cross JSON as-is ("Do not
   * know how to serialize a BigInt" — the profile GET 500'd
   * once a charge was set). Minor units travel as strings,
   * matching how other money leaves this API. */
  static profileJson(profile: any) {
    if (!profile) return profile;
    const out: Record<string, unknown> = { ...profile };
    for (const k of ["monthlyBudgetMinor", "deliveryChargeInsideMinor", "deliveryChargeOutsideMinor", "freeDeliveryAboveMinor", "minOrderMinor", "codMaxOrderMinor", "codAdvanceRequiredAboveMinor", "depositFixedMinor"]) {
      if (typeof out[k] === "bigint") out[k] = (out[k] as bigint).toString();
    }
    // AB4 (AX5a): the deposit config in its canonical settings
    // shape (mode/percent/fixedMinor/appliesTo/note).
    out.deposit = depositConfigOf(profile);
    // GB3 (GC8): codBlockedDistricts travels as an array or null.
    if (out.codBlockedDistricts !== undefined && !Array.isArray(out.codBlockedDistricts)) {
      out.codBlockedDistricts = null;
    }
    return out;
  }

  async updateBusinessProfile(organizationId: string, actorId: string, dto: UpdateBusinessProfileDto) {
    // Milestone 75: validate + normalize the operational layer.
    const data: Record<string, unknown> = { ...dto };
    const MONEY = ["deliveryChargeInsideMinor", "deliveryChargeOutsideMinor", "freeDeliveryAboveMinor", "minOrderMinor", "codMaxOrderMinor", "codAdvanceRequiredAboveMinor", "depositFixedMinor"];
    for (const key of MONEY) {
      if (data[key] != null) data[key] = BigInt(Math.round(Number(data[key])));
    }
    // GB3 (GC8): blocked districts — a bounded list of trimmed,
    // non-empty names; an empty array or null clears to null.
    if ((dto as any).codBlockedDistricts !== undefined) {
      const raw = (dto as any).codBlockedDistricts;
      if (raw === null) {
        data.codBlockedDistricts = null;
      } else {
        if (!Array.isArray(raw) || raw.length > 64) {
          throw new BadRequestException("COD ব্লক করা জেলার তালিকা সর্বোচ্চ ৬৪টি হতে পারবে");
        }
        const cleaned = raw.map((d: any) => String(d ?? "").trim());
        if (cleaned.some((d: string) => d.length === 0 || d.length > 100)) {
          throw new BadRequestException("COD ব্লক করা প্রতিটি জেলার নাম ১–১০০ অক্ষরের হতে হবে");
        }
        data.codBlockedDistricts = cleaned.length ? cleaned : null;
      }
    }
    for (const key of ["bkashNumber", "nagadNumber"] as const) {
      const raw = data[key];
      if (typeof raw === "string" && raw.trim()) {
        const normalized = raw.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString()).replace(/[\s-]/g, "");
        if (!/^01\d{9}$/.test(normalized)) {
          throw new BadRequestException(`${key === "bkashNumber" ? "বিকাশ" : "নগদ"} নম্বরটি সঠিক ১১ ডিজিটের মোবাইল নম্বর হতে হবে (01 দিয়ে শুরু)`);
        }
        data[key] = normalized;
      }
    }
    // Billing Package B5: billing recipients are a bounded,
    // validated email list (max 3, deduped); an empty list
    // clears back to owner-only.
    if (dto.billingEmails != null) {
      const list = (Array.isArray(dto.billingEmails) ? dto.billingEmails : [])
        .map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean);
      if (list.length > 3) throw new BadRequestException("Billing ইমেইল সর্বোচ্চ ৩টি রাখা যাবে");
      for (const e of list) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new BadRequestException(`Billing ইমেইলটি সঠিক নয়: ${e}`);
      }
      (data as any).billingEmails = list.length ? [...new Set(list)] : null;
    }
    // Milestone 77: the AI reply language is a closed set.
    if (dto.aiReplyLanguage != null && dto.aiReplyLanguage !== "") {
      if (!["bn", "en", "auto"].includes(dto.aiReplyLanguage)) {
        throw new BadRequestException("AI এর উত্তরের ভাষা bn, en বা auto হতে হবে");
      }
    }
    if (dto.businessHours != null) {
      const hours = dto.businessHours as { timezone?: string; windows?: unknown };
      const tz = typeof hours.timezone === "string" && hours.timezone ? hours.timezone : "Asia/Dhaka";
      if (!isValidTimezone(tz)) throw new BadRequestException("ব্যবসার সময়ের Timezone টি সঠিক নয়");
      if (!isValidWindows(hours.windows)) throw new BadRequestException("ব্যবসার সময়ের উইন্ডোগুলো সঠিক ফরম্যাটে নয় (HH:MM–HH:MM)");
      data.businessHours = { timezone: tz, windows: hours.windows ?? {} };
    }
    const profile = await (this.prisma as any).businessProfile.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "org.business_profile.update", entityType: "BusinessProfile", entityId: profile.id });
    return OrganizationsService.profileJson(profile);
  }

  /**
   * Milestone 75: how complete is the Business Brain? Computed
   * from real rows only — a section is done when its facts
   * exist, and the AI-readiness lines state plainly which
   * customer questions the AI can answer from verified data.
   */
  async getProfileCompleteness(organizationId: string) {
    const p = this.prisma as any;
    const [profile, policies, faqCount, docCount, productCount] = await Promise.all([
      p.businessProfile.findUnique({ where: { organizationId } }).catch(() => null),
      p.businessPolicy.findMany({ where: { organizationId }, select: { type: true } }).catch(() => []),
      p.knowledgeDocument.count({ where: { organizationId, kind: "faq" } }).catch(() => 0),
      p.knowledgeDocument.count({ where: { organizationId } }).catch(() => 0),
      p.product.count({ where: { organizationId, status: "ACTIVE" } }).catch(() => 0),
    ]);
    const policyTypes = new Set((policies as any[]).map((x) => x.type));
    const has = (...vals: unknown[]) => vals.some((v) => v != null && v !== "" && v !== false);
    const sections = [
      { key: "identity", labelBn: "ব্যবসার পরিচিতি", done: has(profile?.description) && has(profile?.industry), missingBn: "বিবরণ ও ইন্ডাস্ট্রি দিন — AI ব্যবসাটা বুঝতে পারবে" },
      { key: "contact", labelBn: "যোগাযোগ ও ঠিকানা", done: has(profile?.contactPhone, profile?.contactEmail) && has(profile?.address), missingBn: "ফোন/ইমেইল ও ঠিকানা দিন — গ্রাহক জিজ্ঞেস করলেই AI বলতে পারবে" },
      { key: "hours", labelBn: "ব্যবসার সময়", done: Boolean(profile?.businessHours), missingBn: "খোলা-বন্ধের সময় দিন" },
      { key: "delivery", labelBn: "ডেলিভারি তথ্য", done: profile?.deliveryChargeInsideMinor != null && profile?.deliveryDaysInside != null, missingBn: "ডেলিভারি চার্জ ও সময় দিন — সবচেয়ে বেশি জিজ্ঞেস করা প্রশ্ন" },
      { key: "payments", labelBn: "পেমেন্ট তথ্য", done: profile?.codAvailable === true || has(profile?.bkashNumber, profile?.nagadNumber), missingBn: "COD আছে কিনা বা বিকাশ/নগদ নম্বর দিন" },
      { key: "policies", labelBn: "নীতিমালা", done: policyTypes.has("shipping") && (policyTypes.has("return") || policyTypes.has("refund")), missingBn: "শিপিং ও রিটার্ন/রিফান্ড নীতি লিখুন (Knowledge পেজে)" },
      { key: "knowledge", labelBn: "FAQ ও জ্ঞানভান্ডার", done: faqCount >= 1, missingBn: "অন্তত একটি FAQ যোগ করুন (Knowledge পেজে)" },
      { key: "products", labelBn: "পণ্য তালিকা", done: productCount >= 1, missingBn: "পণ্য যোগ করুন — দাম/স্টকের উত্তর এর ওপর দাঁড়িয়ে" },
    ];
    const doneCount = sections.filter((s) => s.done).length;
    return {
      percent: Math.round((100 * doneCount) / sections.length),
      doneCount, totalSections: sections.length, sections,
      counts: { faq: faqCount, documents: docCount, products: productCount, policies: policyTypes.size },
      aiCanAnswer: {
        priceStock: productCount >= 1,
        delivery: sections.find((s) => s.key === "delivery")!.done || policyTypes.has("shipping"),
        payment: sections.find((s) => s.key === "payments")!.done || policyTypes.has("payment"),
        contactHours: sections.find((s) => s.key === "contact")!.done || sections.find((s) => s.key === "hours")!.done,
        faq: faqCount >= 1,
      },
    };
  }

  // ---- Milestone 59: Agency White-Label v1 -------------------------
  // Branding lives on the Organization row (migration
  // 20261010590000_m59_white_label). The logo BYTES go through the
  // existing U6 MediaStore; the row only keeps the public path +
  // content type. Custom domains are settings + guidance only in
  // v1: the codebase has no hostname->org resolution, so the field
  // records the intended domain and the UI explains that routing is
  // completed in the hosting panel (Dokploy). Nothing here pretends
  // a domain is live before DNS + hosting actually route it.

  private _mediaStore: MediaStore | null = null;
  private mediaStore(): MediaStore {
    if (!this._mediaStore) this._mediaStore = MediaStore.fromEnv();
    return this._mediaStore;
  }

  static readonly LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
  static readonly LOGO_MAX_BYTES = 1_500_000;
  static logoKey(organizationId: string) { return `branding/${organizationId}/logo`; }
  static logoPath(organizationId: string) { return `/public/branding/${organizationId}/logo`; }
  /** RB4/RM5: the R2-era logo key — hash-versioned so a replaced
   * logo is a NEW object (CDN caches can never serve the stale
   * one) and the old object simply becomes lifecycle trash. */
  static logoVersionedKey(organizationId: string, hash8: string, contentType: string) {
    return `branding/${organizationId}/logo-${hash8}.${imageExtForContentType(contentType)}`;
  }

  /** Magic-byte sniff: the declared content type must match the
   * actual bytes, so a renamed executable can never become a "logo". */
  static sniffLogoType(bytes: Buffer): string | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    return null;
  }

  async updateBranding(organizationId: string, actorId: string, dto: UpdateBrandingDto, ip?: string) {
    const data: Record<string, string | null> = {};
    if (dto.brandName !== undefined) {
      const name = dto.brandName.trim();
      data.brandName = name === "" ? null : name;
    }
    if (dto.primaryColor !== undefined) {
      const color = dto.primaryColor.trim();
      if (color === "") data.primaryColor = null;
      else if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new BadRequestException("প্রাইমারি রঙ হতে হবে #RRGGBB ফরম্যাটে (যেমন #4F46E5)");
      else data.primaryColor = color.toUpperCase();
    }
    // TD9: when the domain field is present, read the CURRENT org
    // before the update so a real change can be told apart from a
    // re-save of the same value (only a change resets verification
    // below). Normalised comparison on both sides.
    let previousDomain: string | null = null;
    if (dto.customDomain !== undefined) {
      const current = await (this.prisma as any).organization
        .findUnique({ where: { id: organizationId } })
        .catch(() => null);
      previousDomain = current?.customDomain
        ? normalizeCustomDomainInput(current.customDomain) || null
        : null;
    }
    if (dto.customDomain !== undefined) {
      const domain = dto.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (domain === "") data.customDomain = null;
      else {
        if (!/^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(domain)) {
          throw new BadRequestException("ডোমেইনটি সঠিক ফরম্যাটে লিখুন (যেমন reports.youragency.com) — প্রোটোকল বা পাথ ছাড়া");
        }
        // TD9: the platform's own domain / subdomains can never be
        // claimed here either — same refusal as setCustomDomain.
        if (isPlatformHostedDomain(domain)) {
          throw new BadRequestException(PLATFORM_CUSTOM_DOMAIN_MESSAGE);
        }
        const taken = await (this.prisma as any).organization.findFirst({ where: { customDomain: domain, NOT: { id: organizationId } } });
        if (taken) throw new ConflictException("এই ডোমেইনটি অন্য একটি Organization ইতিমধ্যে সংরক্ষণ করেছে");
        data.customDomain = domain;
      }
    }
    if (Object.keys(data).length === 0) throw new BadRequestException("পরিবর্তন করার মতো কোনো ফিল্ড পাঠানো হয়নি");
    const org = await (this.prisma as any).organization.update({ where: { id: organizationId }, data });
    // TD9: a domain CHANGE on this path must also reset the
    // storefront verification — the old domain's proof must never
    // carry over to a new domain (the bug this fixes). Defensive
    // by design: a prisma fake / partial deployment without the
    // storefrontSetting table must not break branding updates, so
    // the lookup is optional-chained and failure-isolated.
    if (dto.customDomain !== undefined) {
      const newDomain = data.customDomain ?? null;
      if (previousDomain !== newDomain) {
        try {
          const settingTable = (this.prisma as any).storefrontSetting;
          const setting = settingTable?.findUnique
            ? await settingTable.findUnique({ where: { organizationId } }).catch(() => null)
            : null;
          if (setting && settingTable?.update) {
            await settingTable.update({
              where: { id: setting.id },
              data: { domainVerifyToken: null, domainVerifiedAt: null },
            });
          }
        } catch {
          // Verification reset is best-effort here; the branding
          // update itself has already succeeded.
        }
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "org.branding.update", entityType: "Organization", entityId: organizationId, metadata: data, ipAddress: ip });
    return { ...org, creditMinor: BigInt(org.creditMinor ?? 0).toString() };
  }

  async uploadLogo(organizationId: string, actorId: string, dto: UploadLogoDto, ip?: string) {
    if (!(OrganizationsService.LOGO_CONTENT_TYPES as readonly string[]).includes(dto.contentType)) {
      throw new BadRequestException("লোগো হতে হবে PNG, JPEG অথবা WebP ছবি");
    }
    let bytes: Buffer;
    try { bytes = Buffer.from(dto.dataBase64, "base64"); } catch { throw new BadRequestException("ছবির ডেটা পড়া যায়নি"); }
    if (bytes.length === 0) throw new BadRequestException("ছবির ডেটা খালি");
    if (bytes.length > OrganizationsService.LOGO_MAX_BYTES) throw new BadRequestException("লোগোর সাইজ সর্বোচ্চ ১.৫ MB হতে পারবে");
    const sniffed = OrganizationsService.sniffLogoType(bytes);
    if (sniffed !== dto.contentType) throw new BadRequestException("ছবির আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না");
    // RB4/RM5: with object storage on, the logo lands in the
    // PUBLIC bucket under a hash-versioned key and logoUrl stores
    // the absolute CDN URL. Local mode keeps the M59 fixed-key +
    // relative-path behaviour byte-for-byte.
    let logoUrl = OrganizationsService.logoPath(organizationId);
    if (this.storage?.mode === "s3") {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = OrganizationsService.logoVersionedKey(organizationId, sha256.slice(0, 8), sniffed);
      await this.storage.put("public", key, bytes, sniffed);
      logoUrl = publicMediaUrl(key);
      if (this.storageRegistry) {
        await this.storageRegistry
          .register({
            organizationId,
            bucket: this.storage.bucketFor("public"),
            key,
            visibility: "public",
            surface: "branding",
            contentType: sniffed,
            sizeBytes: bytes.length,
            sha256,
            status: "active",
            createdById: actorId,
            sourceRef: null,
          })
          .catch(() => undefined);
      }
    } else {
      await this.mediaStore().put(OrganizationsService.logoKey(organizationId), bytes, dto.contentType);
    }
    const org = await (this.prisma as any).organization.update({
      where: { id: organizationId },
      data: { logoUrl, logoContentType: dto.contentType },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "org.branding.logo_upload", entityType: "Organization", entityId: organizationId, metadata: { contentType: dto.contentType, bytes: bytes.length }, ipAddress: ip });
    return { logoUrl: org.logoUrl, logoContentType: org.logoContentType };
  }

  async removeLogo(organizationId: string, actorId: string, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    // RB4/RM5: a CDN-era logo's registry row is marked trashed
    // (the object itself is deleted by RM11's lifecycle job);
    // legacy rows carry no registry entry. Best-effort — removal
    // of the logo from the org must not fail over bookkeeping.
    const removedKey = org.logoUrl ? mediaKeyFromCdnUrl(org.logoUrl) : null;
    if (removedKey && this.storageRegistry) {
      await this.storageRegistry.markTrashed(organizationId, removedKey).catch(() => undefined);
    }
    await (this.prisma as any).organization.update({ where: { id: organizationId }, data: { logoUrl: null, logoContentType: null } });
    await this.audit.log({ organizationId, userId: actorId, action: "org.branding.logo_remove", entityType: "Organization", entityId: organizationId, ipAddress: ip });
    return { logoUrl: null };
  }

  /** RB4/RM5: when the org's stored logoUrl is already an
   * absolute CDN URL, the public branding route redirects there
   * instead of streaming bytes through the API. Returns null for
   * legacy relative rows (and orgs without a logo). */
  async logoRedirectUrl(organizationId: string): Promise<string | null> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org?.logoUrl) return null;
    return mediaKeyFromCdnUrl(org.logoUrl) ? org.logoUrl : null;
  }

  /** Public logo bytes for the shared report page + shell. Returns
   * null when the org has no logo (callers render the default mark). */
  async publicLogo(organizationId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org?.logoUrl || !org?.logoContentType) return null;
    // RB4: a CDN-era row reads its versioned key from the public
    // bucket; the controller normally redirects before this is
    // reached, so this is the belt-and-braces path.
    const cdnKey = mediaKeyFromCdnUrl(org.logoUrl);
    if (cdnKey && this.storage?.mode === "s3") {
      const bytes = await this.storage.get("public", cdnKey).catch(() => null);
      if (!bytes) return null;
      return { bytes, contentType: org.logoContentType };
    }
    const bytes = await this.mediaStore().get(OrganizationsService.logoKey(organizationId)).catch(() => null);
    if (!bytes) return null;
    return { bytes, contentType: org.logoContentType };
  }
}
