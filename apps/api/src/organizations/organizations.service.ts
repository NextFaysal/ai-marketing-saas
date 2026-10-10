import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateOrganizationDto, InviteMemberDto, PlanChangeRequestDto, UpdateBusinessProfileDto } from "./organizations.dto";
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
    const [sub, prices, limits, payments, seatsUsed, aiCallsToday, broadcasts30d] = await Promise.all([
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
    ]);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const pc = await import("../common/platform-config");
    await pc.ensurePlatformConfig(this.prisma as any).catch(() => null);
    return {
      subscription: sub
        ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, priceMinor: String(prices[sub.plan] ?? 0), currency: "BDT" }
        : null,
      // Milestone 39: credit balance + which gateways the
      // platform team has actually configured (buttons in the
      // UI follow these flags, never assumptions).
      creditMinor: BigInt(org?.creditMinor ?? 0).toString(),
      gateways: {
        sslcommerz: pc.effectiveSslcommerzConfig() !== null,
        bkash: pc.effectiveBkashConfig() !== null,
      },
      limits,
      usage: { seatsUsed, aiCallsToday, broadcasts30d },
      plans: ps.PLAN_TIERS.map((tier) => ({
        tier,
        priceMinor: String(prices[tier] ?? 0),
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

  async getBusinessProfile(organizationId: string) {
    return (this.prisma as any).businessProfile.findUnique({ where: { organizationId } });
  }

  async updateBusinessProfile(organizationId: string, actorId: string, dto: UpdateBusinessProfileDto) {
    const profile = await (this.prisma as any).businessProfile.upsert({
      where: { organizationId },
      update: { ...dto },
      create: { organizationId, ...dto },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "org.business_profile.update", entityType: "BusinessProfile", entityId: profile.id });
    return profile;
  }
}
