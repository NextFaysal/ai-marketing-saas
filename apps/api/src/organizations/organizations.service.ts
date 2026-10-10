import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateOrganizationDto, InviteMemberDto, UpdateBusinessProfileDto } from "./organizations.dto";
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
    return org;
  }

  async listMine(userId: string) {
    const memberships = await (this.prisma as any).membership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m: any) => ({ ...m.organization, myRole: m.role }));
  }

  async getOne(organizationId: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    return org;
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
