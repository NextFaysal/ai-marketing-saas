import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateOrganizationDto, InviteMemberDto, PlanChangeRequestDto, UpdateBrandingDto, UpdateBusinessProfileDto, UploadLogoDto } from "./organizations.dto";
import { MediaStore } from "../inbox/media-store";
import { PERMISSION_AREAS, effectiveAccess, findUnknownAreas, normalizeOverrides } from "../common/permission-catalog";
import { isValidTimezone, isValidWindows } from "../inbox/working-hours";
import { EmailProvider } from "../messaging/email.provider";
import { Role } from "@repo/db";

const INVITABLE_ROLES: Role[] = ["ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"] as Role[];

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(userId: string, dto: CreateOrganizationDto, ip?: string) {
    const slugTaken = await (this.prisma as any).organization.findUnique({ where: { slug: dto.slug } });
    if (slugTaken) throw new ConflictException("This slug is already taken");
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
    return (this.prisma as any).membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
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
    const { orgLimitOverrides, orgPlan, DEFAULT_PLAN_LIMITS } = await import("../common/platform-settings");
    const overrides = await orgLimitOverrides(this.prisma as any, organizationId);
    const seatLimit = overrides.seatLimit ?? DEFAULT_PLAN_LIMITS[await orgPlan(this.prisma as any, organizationId)]?.seats ?? null;
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
    const [sub, prices, limits, payments, seatsUsed, aiCallsToday, broadcasts30d, yearlyPrices] = await Promise.all([
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
    return {
      nextInvoice,
      subscription: sub
        ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, pendingPlan: sub.pendingPlan ?? null, billingCycle: sub.billingCycle ?? "monthly", priceMinor: String((sub.billingCycle === "yearly" ? yearlyPrices : prices)[sub.plan] ?? 0), currency: "BDT" }
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
        limits: ps.DEFAULT_PLAN_LIMITS[tier],
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
    const seatLimit = overrides.seatLimit ?? ps.DEFAULT_PLAN_LIMITS[await ps.orgPlan(this.prisma as any, organizationId)]?.seats ?? null;
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
    return {
      userId: targetUserId, role: target.role,
      overrides,
      effective: effectiveAccess(target.role, target.permissionOverrides),
    };
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
    const limit = overrides.seatLimit ?? ps.DEFAULT_PLAN_LIMITS[await ps.orgPlan(this.prisma as any, organizationId)]?.seats ?? null;
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

  /** BigInt money fields cannot cross JSON as-is ("Do not
   * know how to serialize a BigInt" — the profile GET 500'd
   * once a charge was set). Minor units travel as strings,
   * matching how other money leaves this API. */
  static profileJson(profile: any) {
    if (!profile) return profile;
    const out: Record<string, unknown> = { ...profile };
    for (const k of ["monthlyBudgetMinor", "deliveryChargeInsideMinor", "deliveryChargeOutsideMinor", "freeDeliveryAboveMinor", "minOrderMinor"]) {
      if (typeof out[k] === "bigint") out[k] = (out[k] as bigint).toString();
    }
    return out;
  }

  async updateBusinessProfile(organizationId: string, actorId: string, dto: UpdateBusinessProfileDto) {
    // Milestone 75: validate + normalize the operational layer.
    const data: Record<string, unknown> = { ...dto };
    const MONEY = ["deliveryChargeInsideMinor", "deliveryChargeOutsideMinor", "freeDeliveryAboveMinor", "minOrderMinor"];
    for (const key of MONEY) {
      if (data[key] != null) data[key] = BigInt(Math.round(Number(data[key])));
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
    if (dto.customDomain !== undefined) {
      const domain = dto.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (domain === "") data.customDomain = null;
      else {
        if (!/^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(domain)) {
          throw new BadRequestException("ডোমেইনটি সঠিক ফরম্যাটে লিখুন (যেমন reports.youragency.com) — প্রোটোকল বা পাথ ছাড়া");
        }
        const taken = await (this.prisma as any).organization.findFirst({ where: { customDomain: domain, NOT: { id: organizationId } } });
        if (taken) throw new ConflictException("এই ডোমেইনটি অন্য একটি Organization ইতিমধ্যে সংরক্ষণ করেছে");
        data.customDomain = domain;
      }
    }
    if (Object.keys(data).length === 0) throw new BadRequestException("পরিবর্তন করার মতো কোনো ফিল্ড পাঠানো হয়নি");
    const org = await (this.prisma as any).organization.update({ where: { id: organizationId }, data });
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
    await this.mediaStore().put(OrganizationsService.logoKey(organizationId), bytes, dto.contentType);
    const org = await (this.prisma as any).organization.update({
      where: { id: organizationId },
      data: { logoUrl: OrganizationsService.logoPath(organizationId), logoContentType: dto.contentType },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "org.branding.logo_upload", entityType: "Organization", entityId: organizationId, metadata: { contentType: dto.contentType, bytes: bytes.length }, ipAddress: ip });
    return { logoUrl: org.logoUrl, logoContentType: org.logoContentType };
  }

  async removeLogo(organizationId: string, actorId: string, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    await (this.prisma as any).organization.update({ where: { id: organizationId }, data: { logoUrl: null, logoContentType: null } });
    await this.audit.log({ organizationId, userId: actorId, action: "org.branding.logo_remove", entityType: "Organization", entityId: organizationId, ipAddress: ip });
    return { logoUrl: null };
  }

  /** Public logo bytes for the shared report page + shell. Returns
   * null when the org has no logo (callers render the default mark). */
  async publicLogo(organizationId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org?.logoUrl || !org?.logoContentType) return null;
    const bytes = await this.mediaStore().get(OrganizationsService.logoKey(organizationId)).catch(() => null);
    if (!bytes) return null;
    return { bytes, contentType: org.logoContentType };
  }
}
