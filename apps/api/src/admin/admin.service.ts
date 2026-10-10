import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { platformSetting, PLAN_TIERS, DEFAULT_PLAN_LIMITS, planPrices } from "../common/platform-settings";
import { seal, refreshPlatformConfig, effectiveLlmConfig } from "../common/platform-config";
import { buildLlmProvider } from "../ai/llm/llm.factory";
import { EmailProvider } from "../messaging/email.provider";
import { buildInvoiceHtml } from "../payments/payments.service";
import { SmsProvider, normalizeBdPhone } from "../messaging/sms.provider";
import { AuditService } from "../audit/audit.service";
import { issueAdminToken } from "../common/admin-token";

const ADMIN_TIERS = ["SUPER", "SUPPORT", "FINANCE"] as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async logAdmin(actor: any, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>, ip?: string) {
    await this.audit.log({ userId: actor.id, action: `admin.${action}`, entityType, entityId, metadata, ipAddress: ip });
  }

  private requireReason(reason?: string) {
    if (!reason?.trim()) throw new BadRequestException("A reason is required for this admin action (it is stored in the audit trail)");
    return reason.trim();
  }

  async health() {
    let db = "ok";
    try { await (this.prisma as any).$queryRaw`SELECT 1`; } catch { db = "down"; }
    return { api: "ok", db, time: new Date().toISOString() };
  }

  async overview() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const since30 = new Date(now.getTime() - 30 * 86400000);
    const since24h = new Date(now.getTime() - 86400000);
    const [orgs, users, newOrgs, newUsers] = await Promise.all([
      (this.prisma as any).organization.count({ where: {} }),
      (this.prisma as any).user.count({ where: {} }),
      (this.prisma as any).organization.count({ where: { createdAt: { gte: since30 } } }),
      (this.prisma as any).user.count({ where: { createdAt: { gte: since30 } } }),
    ]);
    const orders = await (this.prisma as any).order.findMany({ where: { createdAt: { gte: monthStart } }, take: 20000 });
    let revenue = 0n; let orderCount = 0;
    for (const o of orders as any[]) {
      if (["cancelled", "refunded"].includes(String(o.status))) continue;
      revenue += BigInt(o.totalMinor ?? 0); orderCount++;
    }
    const metrics = await (this.prisma as any).dailyAdMetric.findMany({ where: { date: { gte: monthStart } }, take: 20000 });
    let adSpend = 0n;
    for (const r of metrics as any[]) if ((r.adExternalId ?? "") === "") adSpend += BigInt(r.spendMinor ?? 0);
    const ai = await (this.prisma as any).aIUsageRecord.findMany({ where: { createdAt: { gte: monthStart } }, take: 20000 });
    let aiCalls = 0, aiTokens = 0;
    for (const r of ai as any[]) { aiCalls++; aiTokens += Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0); }
    const [failedSync, failedRuns] = await Promise.all([
      (this.prisma as any).syncJob.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }).catch(() => 0),
      (this.prisma as any).automationRun.count({ where: { status: "error", createdAt: { gte: since24h } } }).catch(() => 0),
    ]);
    const recentAdminActions = await (this.prisma as any).auditLog.findMany({
      where: { action: { startsWith: "admin." } }, orderBy: { createdAt: "desc" }, take: 10,
    }).catch(() => []);
    return {
      organizations: orgs, users, newOrganizations30d: newOrgs, newUsers30d: newUsers,
      monthOrders: orderCount, monthOrderRevenueMinor: revenue.toString(),
      monthAdSpendMinor: adSpend.toString(),
      monthAiCalls: aiCalls, monthAiTokens: aiTokens,
      failedSyncJobs24h: failedSync, failedAutomationRuns24h: failedRuns,
      recentAdminActions,
    };
  }

  // ---------------- Users ----------------
  async listUsers(q?: string, page = 1, take = 25) {
    const where: any = q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {};
    const rows = await (this.prisma as any).user.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take,
      select: { id: true, email: true, name: true, isSuperAdmin: true, adminTier: true, status: true, lastLoginAt: true, createdAt: true },
    });
    const ids = rows.map((r: any) => r.id);
    const memberships = await (this.prisma as any).membership.findMany({ where: { userId: { in: ids } } });
    return rows.map((r: any) => ({ ...r, organizationCount: memberships.filter((m: any) => m.userId === r.id).length }));
  }

  async userDetail(id: string) {
    const user = await (this.prisma as any).user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, isSuperAdmin: true, adminTier: true, status: true, lastLoginAt: true, createdAt: true, totpEnabled: true },
    });
    if (!user) throw new NotFoundException("User not found");
    const memberships = await (this.prisma as any).membership.findMany({ where: { userId: id } });
    const orgs = await (this.prisma as any).organization.findMany({ where: { id: { in: memberships.map((m: any) => m.organizationId) } } });
    const auditTrail = await (this.prisma as any).auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 20 });
    return {
      ...user,
      memberships: memberships.map((m: any) => ({ ...m, organizationName: orgs.find((o: any) => o.id === m.organizationId)?.name ?? null })),
      auditTrail,
    };
  }

  async setUserStatus(actor: any, tier: string, id: string, status: string, reason: string, ip?: string) {
    if (!["ACTIVE", "SUSPENDED", "DELETED"].includes(status)) throw new BadRequestException("status must be ACTIVE, SUSPENDED or DELETED");
    const why = this.requireReason(reason);
    const user = await (this.prisma as any).user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    if (user.id === actor.id) throw new ForbiddenException("You cannot change your own account status");
    if (user.isSuperAdmin && tier !== "SUPER") throw new ForbiddenException("Changing an admin's status requires the SUPER tier");
    const from = user.status;
    const updated = await (this.prisma as any).user.update({ where: { id }, data: { status } });
    await this.logAdmin(actor, "user_status", "User", id, { from, to: status, reason: why }, ip);
    return { id, status: updated.status };
  }

  async grantAdmin(actor: any, id: string, tier: string, reason: string, ip?: string) {
    if (!(ADMIN_TIERS as readonly string[]).includes(tier)) throw new BadRequestException("tier must be SUPER, SUPPORT or FINANCE");
    const why = this.requireReason(reason);
    const user = await (this.prisma as any).user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    if (user.status !== "ACTIVE") throw new BadRequestException("Only an ACTIVE user can be granted admin");
    await (this.prisma as any).user.update({ where: { id }, data: { isSuperAdmin: true, adminTier: tier } });
    await this.logAdmin(actor, "grant", "User", id, { tier, reason: why }, ip);
    return { id, isSuperAdmin: true, adminTier: tier };
  }

  async revokeAdmin(actor: any, id: string, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const user = await (this.prisma as any).user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    if (user.id === actor.id) throw new ForbiddenException("You cannot revoke your own admin access — ask another SUPER admin or use the CLI");
    if (user.adminTier === "SUPER" || (!user.adminTier && user.isSuperAdmin)) {
      // Only genuine SUPER-tier admins count toward the last-admin
      // protection — SUPPORT/FINANCE admins cannot grant SUPER back.
      const supers = await (this.prisma as any).user.count({
        where: { isSuperAdmin: true, status: "ACTIVE", OR: [{ adminTier: "SUPER" }, { adminTier: null }] },
      });
      if (supers <= 1) throw new ForbiddenException("This is the last active super admin and cannot be revoked");
    }
    await (this.prisma as any).user.update({ where: { id }, data: { isSuperAdmin: false, adminTier: null, tokenVersion: (user.tokenVersion ?? 0) + 1 } });
    await this.logAdmin(actor, "revoke", "User", id, { reason: why }, ip);
    return { id, isSuperAdmin: false };
  }

  async forceReset(actor: any, id: string, ip?: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    const token = issueAdminToken({ purpose: "pwd-reset", sub: id, tv: user.tokenVersion ?? 0 }, 60);
    await this.logAdmin(actor, "force_reset_issued", "User", id, {}, ip);
    return { resetPath: `/reset-password?token=${token}`, expiresInMinutes: 60, note: "Hand this link to the user through a verified channel. It works once — using it revokes all existing sessions." };
  }

  // ---------------- Organizations ----------------
  async listOrgs(q?: string, page = 1, take = 25) {
    const where: any = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : {};
    const rows = await (this.prisma as any).organization.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take });
    const out: any[] = [];
    for (const org of rows as any[]) {
      const [members, orders, sub] = await Promise.all([
        (this.prisma as any).membership.count({ where: { organizationId: org.id } }),
        (this.prisma as any).order.count({ where: { organizationId: org.id } }),
        (this.prisma as any).subscription.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" } }).catch(() => null),
      ]);
      out.push({ ...org, creditMinor: BigInt(org.creditMinor ?? 0).toString(), memberCount: members, orderCount: orders, subscription: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd } : null });
    }
    return out;
  }

  async orgDetail(id: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException("Organization not found");
    const memberships = await (this.prisma as any).membership.findMany({ where: { organizationId: id } });
    const users = await (this.prisma as any).user.findMany({
      where: { id: { in: memberships.map((m: any) => m.userId) } },
      select: { id: true, email: true, name: true, status: true },
    });
    const integrations = await (this.prisma as any).integration.findMany({ where: { organizationId: id } });
    const subscription = await (this.prisma as any).subscription.findFirst({ where: { organizationId: id }, orderBy: { createdAt: "desc" } }).catch(() => null);
    const [products, orders, conversations, campaigns] = await Promise.all([
      (this.prisma as any).product.count({ where: { organizationId: id } }),
      (this.prisma as any).order.count({ where: { organizationId: id } }),
      (this.prisma as any).channelConversation.count({ where: { organizationId: id } }).catch(() => 0),
      (this.prisma as any).campaignPlan.count({ where: { organizationId: id } }),
    ]);
    return {
      ...org,
      creditMinor: BigInt(org.creditMinor ?? 0).toString(),
      members: memberships.map((m: any) => ({ ...m, user: users.find((u: any) => u.id === m.userId) ?? null })),
      integrations: integrations.map((i: any) => ({ id: i.id, provider: i.provider, status: i.status })),
      subscription,
      counts: { products, orders, conversations, campaigns },
    };
  }

  async setOrgStatus(actor: any, id: string, status: string, reason: string, ip?: string) {
    if (!["ACTIVE", "SUSPENDED", "DELETED"].includes(status)) throw new BadRequestException("status must be ACTIVE, SUSPENDED or DELETED");
    const why = this.requireReason(reason);
    const org = await (this.prisma as any).organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException("Organization not found");
    const from = org.status;
    await (this.prisma as any).organization.update({ where: { id }, data: { status } });
    await this.logAdmin(actor, "org_status", "Organization", id, { from, to: status, reason: why }, ip);
    return { id, status };
  }

  async search(q: string) {
    const needle = String(q ?? "").trim();
    if (needle.length < 2) return { users: [], organizations: [], orders: [] };
    const [users, organizations, orders] = await Promise.all([
      (this.prisma as any).user.findMany({ where: { OR: [{ email: { contains: needle, mode: "insensitive" } }, { name: { contains: needle, mode: "insensitive" } }] }, take: 5, select: { id: true, email: true, name: true, status: true } }),
      (this.prisma as any).organization.findMany({ where: { OR: [{ name: { contains: needle, mode: "insensitive" } }, { slug: { contains: needle, mode: "insensitive" } }] }, take: 5 }),
      (this.prisma as any).order.findMany({ where: { externalNumber: { contains: needle } }, take: 5 }).catch(() => []),
    ]);
    return { users, organizations, orders };
  }

  async addNote(actor: any, targetType: string, targetId: string, body: string) {
    if (!["user", "organization"].includes(targetType)) throw new BadRequestException("targetType must be user or organization");
    if (!body?.trim()) throw new BadRequestException("Note body is required");
    return (this.prisma as any).adminNote.create({ data: { targetType, targetId, body: body.trim(), authorId: actor.id } });
  }

  async listNotes(targetType: string, targetId: string) {
    return (this.prisma as any).adminNote.findMany({ where: { targetType, targetId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async auditTrail(filters: { action?: string; userId?: string; take?: number }) {
    const where: any = {};
    if (filters.action) where.action = { startsWith: filters.action };
    if (filters.userId) where.userId = filters.userId;
    return (this.prisma as any).auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(200, filters.take ?? 50) });
  }

  // ---------------- Platform settings, announcements, flags ----------------
  static readonly SETTING_KEYS = ["maintenanceMode", "signupOpen", "supportContact", "killSwitches", "planPrices"] as const;

  async getSettings() {
    const out: Record<string, unknown> = {
      maintenanceMode: false, signupOpen: true, supportContact: "",
      killSwitches: { aiDisabledOrgIds: [], broadcastsPaused: false },
      planPrices: await planPrices(this.prisma as any),
    };
    for (const key of AdminService.SETTING_KEYS) {
      const v = await platformSetting(this.prisma as any, key);
      if (v !== null && v !== undefined) out[key] = v;
    }
    return out;
  }

  async updateSettings(actor: any, patch: Record<string, unknown>, ip?: string) {
    const changed: string[] = [];
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (value === undefined) continue; // transformed DTOs carry unset fields as undefined
      if (!(AdminService.SETTING_KEYS as readonly string[]).includes(key)) {
        throw new BadRequestException(`Unknown setting key: ${key}`);
      }
      if (key === "maintenanceMode" || key === "signupOpen") {
        if (typeof value !== "boolean") throw new BadRequestException(`${key} must be a boolean`);
      }
      if (key === "supportContact" && typeof value !== "string") throw new BadRequestException("supportContact must be a string");
      if (key === "killSwitches") {
        const ks = value as any;
        if (!ks || typeof ks !== "object" || !Array.isArray(ks.aiDisabledOrgIds) || typeof ks.broadcastsPaused !== "boolean") {
          throw new BadRequestException("killSwitches must be { aiDisabledOrgIds: string[], broadcastsPaused: boolean }");
        }
      }
      if (key === "planPrices") {
        const pp = value as any;
        if (!pp || typeof pp !== "object") throw new BadRequestException("planPrices must be an object");
        for (const tier of PLAN_TIERS) {
          if (pp[tier] !== undefined && (typeof pp[tier] !== "number" || pp[tier] < 0)) {
            throw new BadRequestException(`planPrices.${tier} must be a non-negative number (minor units)`);
          }
        }
      }
      await (this.prisma as any).systemSetting.upsert({
        where: { key }, create: { key, value: value as any, updatedById: actor.id }, update: { value: value as any, updatedById: actor.id },
      });
      changed.push(key);
    }
    if (changed.length) await this.logAdmin(actor, "settings_updated", "SystemSetting", changed.join(","), { changed }, ip);
    return this.getSettings();
  }

  async publicStatus() {
    const settings = await this.getSettings();
    const now = new Date();
    const announcements = await (this.prisma as any).announcement?.findMany?.({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 10 }).catch(() => []) ?? [];
    const current = (announcements as any[]).find((a) => (!a.startsAt || new Date(a.startsAt) <= now) && (!a.endsAt || new Date(a.endsAt) >= now)) ?? null;
    return {
      maintenanceMode: settings.maintenanceMode === true,
      signupOpen: settings.signupOpen !== false,
      supportContact: settings.supportContact ?? "",
      announcement: current ? { title: current.title, body: current.body } : null,
    };
  }

  async listAnnouncements() {
    return (this.prisma as any).announcement.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }
  async createAnnouncement(actor: any, dto: { title: string; body: string; startsAt?: string; endsAt?: string }, ip?: string) {
    if (!dto.title?.trim() || !dto.body?.trim()) throw new BadRequestException("Announcement title and body are required");
    const row = await (this.prisma as any).announcement.create({
      data: { title: dto.title.trim(), body: dto.body.trim(), startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, active: true, createdById: actor.id },
    });
    await this.logAdmin(actor, "announcement_created", "Announcement", row.id, { title: row.title }, ip);
    return row;
  }
  async setAnnouncementActive(actor: any, id: string, active: boolean, ip?: string) {
    const row = await (this.prisma as any).announcement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Announcement not found");
    await (this.prisma as any).announcement.update({ where: { id }, data: { active } });
    await this.logAdmin(actor, active ? "announcement_activated" : "announcement_deactivated", "Announcement", id, {}, ip);
    return { id, active };
  }
  async deleteAnnouncement(actor: any, id: string, ip?: string) {
    const row = await (this.prisma as any).announcement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Announcement not found");
    await (this.prisma as any).announcement.delete({ where: { id } });
    await this.logAdmin(actor, "announcement_deleted", "Announcement", id, { title: row.title }, ip);
    return { id, deleted: true };
  }

  static readonly KNOWN_FLAGS = ["dayparting", "portfolio", "creative_library", "order_bot", "offline_conversions", "agency_portfolio"];

  async getOrgFlags(organizationId: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const rows = await (this.prisma as any).orgFeatureFlag.findMany({ where: { organizationId } });
    return { knownFlags: AdminService.KNOWN_FLAGS, flags: rows };
  }
  async setOrgFlag(actor: any, organizationId: string, key: string, enabled: boolean, ip?: string) {
    if (!key?.trim()) throw new BadRequestException("Flag key is required");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const row = await (this.prisma as any).orgFeatureFlag.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, enabled }, update: { enabled },
    });
    await this.logAdmin(actor, "flag_set", "Organization", organizationId, { key, enabled }, ip);
    return row;
  }

  async updateOrgLimits(actor: any, organizationId: string, patch: { aiDailyLimitOverride?: number | null; broadcastCapOverride?: number | null; seatLimit?: number | null }, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const data: Record<string, unknown> = {};
    for (const field of ["aiDailyLimitOverride", "broadcastCapOverride", "seatLimit"] as const) {
      if (patch[field] !== undefined) {
        const v = patch[field];
        if (v !== null && (!Number.isInteger(v) || (v as number) < 0)) throw new BadRequestException(`${field} must be a non-negative integer or null`);
        data[field] = v;
      }
    }
    const before = { aiDailyLimitOverride: org.aiDailyLimitOverride ?? null, broadcastCapOverride: org.broadcastCapOverride ?? null, seatLimit: org.seatLimit ?? null };
    await (this.prisma as any).organization.update({ where: { id: organizationId }, data });
    await this.logAdmin(actor, "org_limits", "Organization", organizationId, { before, after: { ...before, ...data } }, ip);
    const updated = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    return { ...updated, creditMinor: BigInt(updated?.creditMinor ?? 0).toString() };
  }

  // ---------------- Platform health & usage ----------------
  async healthIntegrations() {
    const rows = await (this.prisma as any).integration.findMany({ take: 1000 });
    const orgs = await (this.prisma as any).organization.findMany({ where: { id: { in: [...new Set((rows as any[]).map((r) => r.organizationId))] } } }).catch(() => []);
    const nameOf = (id: string) => (orgs as any[]).find((o) => o.id === id)?.name ?? id;
    const byProvider: Record<string, { total: number; connected: number }> = {};
    const broken: any[] = [];
    for (const r of rows as any[]) {
      byProvider[r.provider] ??= { total: 0, connected: 0 };
      byProvider[r.provider].total++;
      if (r.status === "CONNECTED") byProvider[r.provider].connected++;
      else broken.push({ id: r.id, provider: r.provider, status: r.status, organizationId: r.organizationId, organizationName: nameOf(r.organizationId), updatedAt: r.updatedAt ?? null });
    }
    return { byProvider, broken: broken.slice(0, 100) };
  }

  async healthJobs() {
    const since24h = new Date(Date.now() - 86400000);
    const [failedSync, errorRuns, scheduled] = await Promise.all([
      (this.prisma as any).syncJob.findMany({ where: { status: "FAILED" }, orderBy: { startedAt: "desc" }, take: 20 }).catch(() => []),
      (this.prisma as any).automationRun.findMany({ where: { status: "error", createdAt: { gte: since24h } }, orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
      (this.prisma as any).scheduledJob.findMany({ orderBy: { nextRunAt: "asc" }, take: 100 }).catch(() => []),
    ]);
    return { failedSyncJobs: failedSync, errorRuns24h: errorRuns, scheduledJobs: scheduled };
  }

  async usageBoard() {
    const since30 = new Date(Date.now() - 30 * 86400000);
    const orgs = await (this.prisma as any).organization.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    const out: any[] = [];
    for (const org of orgs as any[]) {
      const [aiRows, deliveries, broadcasts, workflowRuns, shipments, orders] = await Promise.all([
        (this.prisma as any).aIUsageRecord.findMany({ where: { organizationId: org.id, createdAt: { gte: since30 } }, take: 5000 }).catch(() => []),
        (this.prisma as any).messageDelivery.count({ where: { organizationId: org.id, createdAt: { gte: since30 } } }).catch(() => 0),
        (this.prisma as any).broadcast.count({ where: { organizationId: org.id } }).catch(() => 0),
        (this.prisma as any).workflowRun.count({ where: { organizationId: org.id, createdAt: { gte: since30 } } }).catch(() => 0),
        (this.prisma as any).courierShipment.count({ where: { organizationId: org.id } }).catch(() => 0),
        (this.prisma as any).order.count({ where: { organizationId: org.id, createdAt: { gte: since30 } } }).catch(() => 0),
      ]);
      let aiTokens = 0;
      for (const r of aiRows as any[]) aiTokens += Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0);
      out.push({
        organizationId: org.id, name: org.name, status: org.status,
        aiCalls30d: (aiRows as any[]).length, aiTokens30d: aiTokens,
        deliveries30d: deliveries, broadcastsTotal: broadcasts, workflowRuns30d: workflowRuns,
        courierShipmentsTotal: shipments, orders30d: orders,
      });
    }
    return out;
  }

  // ---------------- Support view (metadata-first; content is a separate audited act) ----------------
  async supportView(organizationId: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const [orders, conversations] = await Promise.all([
      (this.prisma as any).order.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 10 }),
      (this.prisma as any).channelConversation.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, take: 10 }).catch(() => []),
    ]);
    const convOut: any[] = [];
    for (const c of conversations as any[]) {
      const messageCount = await (this.prisma as any).channelMessage.count({ where: { conversationId: c.id } }).catch(() => 0);
      convOut.push({ id: c.id, channel: c.channel, status: c.status, contactName: c.contactName ?? null, updatedAt: c.updatedAt, messageCount });
    }
    return {
      organization: { id: org.id, name: org.name, status: org.status },
      recentOrders: (orders as any[]).map((o) => ({ id: o.id, externalNumber: o.externalNumber ?? null, status: o.status, totalMinor: String(o.totalMinor ?? 0), source: o.source ?? null, createdAt: o.createdAt })),
      recentConversations: convOut,
    };
  }

  async supportConversationMessages(actor: any, organizationId: string, conversationId: string, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const conv = await (this.prisma as any).channelConversation.findFirst({ where: { id: conversationId, organizationId } }).catch(() => null);
    if (!conv) throw new NotFoundException("Conversation not found in this organization");
    await this.logAdmin(actor, "support_content_access", "ChannelConversation", conversationId, { organizationId, reason: why }, ip);
    const messages = await (this.prisma as any).channelMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 50 });
    return { conversationId, messages: (messages as any[]).map((m) => ({ direction: m.direction, body: m.body ?? m.text ?? null, createdAt: m.createdAt })) };
  }

  async findScheduledJob(id: string) {
    return (this.prisma as any).scheduledJob.findUnique({ where: { id } }).catch(() => null);
  }
  async findSyncJob(id: string) {
    const job = await (this.prisma as any).syncJob.findUnique({ where: { id } }).catch(() => null);
    if (!job) return null;
    const integration = await (this.prisma as any).integration.findUnique({ where: { id: job.integrationId } }).catch(() => null);
    return { ...job, organizationId: integration?.organizationId ?? null };
  }

  // ---------------- SaaS billing (Phase C) ----------------
  static readonly PLANS = ["FREE", "STARTER", "GROWTH", "AGENCY"];
  static readonly SUB_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"];
  static readonly PAYMENT_METHODS = ["bkash", "bank", "cash", "card", "other"];

  async updateSubscription(actor: any, organizationId: string, dto: { plan?: string; status?: string; currentPeriodEnd?: string | null }, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    if (dto.plan !== undefined && !AdminService.PLANS.includes(dto.plan)) throw new BadRequestException(`plan must be one of ${AdminService.PLANS.join(", ")}`);
    if (dto.status !== undefined && !AdminService.SUB_STATUSES.includes(dto.status)) throw new BadRequestException(`status must be one of ${AdminService.SUB_STATUSES.join(", ")}`);
    const existing = await (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    const data: Record<string, unknown> = {};
    if (dto.plan !== undefined) data.plan = dto.plan;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.currentPeriodEnd !== undefined) data.currentPeriodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null;
    const before = existing ? { plan: existing.plan, status: existing.status, currentPeriodEnd: existing.currentPeriodEnd } : null;
    // Milestone 39 proration: changing the plan of an ACTIVE
    // subscription mid-period credits the unused fraction of
    // the OLD plan's price (30-day periods) to the org's credit
    // balance. The credit is real, recorded, and spent by the
    // checkout flow — it is never a silent date adjustment.
    let prorationCredit = 0n;
    if (existing && dto.plan && dto.plan !== existing.plan && existing.status === "ACTIVE"
      && existing.currentPeriodEnd && new Date(existing.currentPeriodEnd) > new Date()) {
      const prices = await planPrices(this.prisma as any);
      const oldPrice = BigInt(prices[existing.plan] ?? 0);
      const remainingDays = Math.min(30, Math.ceil((new Date(existing.currentPeriodEnd).getTime() - Date.now()) / 86400000));
      if (oldPrice > 0n && remainingDays > 0) prorationCredit = (oldPrice * BigInt(remainingDays)) / 30n;
    }
    const row = existing
      ? await (this.prisma as any).subscription.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).subscription.create({ data: { organizationId, plan: dto.plan ?? "FREE", status: dto.status ?? "TRIALING", currentPeriodEnd: data.currentPeriodEnd ?? null } });
    if (prorationCredit > 0n) {
      const balance = BigInt(org.creditMinor ?? 0);
      await (this.prisma as any).organization.update({
        where: { id: organizationId }, data: { creditMinor: balance + prorationCredit },
      }).catch(() => null);
      try {
        await (this.prisma as any).adminNote?.create({
          data: {
            targetType: "organization", targetId: organizationId, authorId: actor.id,
            body: `Proration credit: ${prorationCredit.toString()} minor added for the mid-period plan change ${existing.plan} -> ${dto.plan} (reason: ${why}).`,
          },
        });
      } catch { /* the note is explanatory; the credit + audit are the record */ }
    }
    await this.logAdmin(actor, "subscription_updated", "Organization", organizationId, { before, after: { plan: row.plan, status: row.status, currentPeriodEnd: row.currentPeriodEnd }, reason: why, prorationCreditMinor: prorationCredit.toString() }, ip);
    return { ...row, prorationCreditMinor: prorationCredit.toString() };
  }

  async recordPayment(actor: any, dto: { organizationId: string; amountMinor: string | number; currency?: string; method: string; reference?: string; periodStart?: string; periodEnd?: string; note?: string }, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: dto.organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    if (!AdminService.PAYMENT_METHODS.includes(dto.method)) throw new BadRequestException(`method must be one of ${AdminService.PAYMENT_METHODS.join(", ")}`);
    let amount: bigint;
    try { amount = BigInt(dto.amountMinor); } catch { throw new BadRequestException("amountMinor must be an integer in minor units"); }
    if (amount <= 0n) throw new BadRequestException("Payment amount must be positive");
    const row = await (this.prisma as any).saasPayment.create({
      data: {
        organizationId: dto.organizationId, amountMinor: amount, currency: dto.currency ?? "BDT", method: dto.method,
        reference: dto.reference ?? null, periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null, recordedById: actor.id, note: dto.note ?? null,
      },
    });
    await this.logAdmin(actor, "payment_recorded", "SaasPayment", row.id, { organizationId: dto.organizationId, amountMinor: amount.toString(), method: dto.method, reference: dto.reference ?? null }, ip);
    return { ...row, amountMinor: row.amountMinor.toString(), refundedMinor: BigInt(row.refundedMinor ?? 0).toString() };
  }

  async listPayments(organizationId?: string, take = 50) {
    const rows = await (this.prisma as any).saasPayment.findMany({
      where: organizationId ? { organizationId } : {}, orderBy: { createdAt: "desc" }, take: Math.min(200, take),
    });
    const orgs = await (this.prisma as any).organization.findMany({ where: { id: { in: [...new Set((rows as any[]).map((r) => r.organizationId))] } } }).catch(() => []);
    return (rows as any[]).map((r) => ({
      ...r,
      amountMinor: r.amountMinor.toString(),
      refundedMinor: BigInt(r.refundedMinor ?? 0).toString(),
      netMinor: (BigInt(r.amountMinor ?? 0) - BigInt(r.refundedMinor ?? 0)).toString(),
      organizationName: (orgs as any[]).find((o) => o.id === r.organizationId)?.name ?? null,
    }));
  }

  async deletePayment(actor: any, id: string, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const row = await (this.prisma as any).saasPayment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Payment not found");
    await this.logAdmin(actor, "payment_deleted", "SaasPayment", id, { snapshot: { ...row, amountMinor: row.amountMinor.toString() }, reason: why }, ip);
    await (this.prisma as any).saasPayment.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------------- Phase A3 (Milestone 39): Billing & Money++ ----------------

  /** Record a refund against a payment. The refund itself is
   * the operator's attestation that money went back through the
   * original channel. Access consequences are EXPLICIT: only
   * `revokeAccess: true` flips the subscription to PAST_DUE —
   * a refund never silently rewrites period dates. */
  async refundPayment(actor: any, id: string, dto: { amountMinor?: string | number; reason: string; revokeAccess?: boolean }, ip?: string) {
    const why = this.requireReason(dto.reason);
    const row = await (this.prisma as any).saasPayment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Payment not found");
    const gross = BigInt(row.amountMinor ?? 0);
    const already = BigInt(row.refundedMinor ?? 0);
    const remaining = gross - already;
    if (remaining <= 0n) throw new BadRequestException("This payment has already been fully refunded");
    let amount: bigint;
    if (dto.amountMinor !== undefined && dto.amountMinor !== null && String(dto.amountMinor) !== "") {
      try { amount = BigInt(dto.amountMinor); } catch { throw new BadRequestException("amountMinor must be an integer in minor units"); }
    } else {
      amount = remaining;
    }
    if (amount <= 0n) throw new BadRequestException("Refund amount must be positive");
    if (amount > remaining) throw new BadRequestException(`Refund exceeds the remaining refundable amount (${remaining.toString()} minor)`);
    const updated = await (this.prisma as any).saasPayment.update({
      where: { id },
      data: { refundedMinor: already + amount, refundedAt: new Date(), refundReason: why },
    });
    let accessRevoked = false;
    if (dto.revokeAccess === true) {
      const sub = await (this.prisma as any).subscription.findFirst({
        where: { organizationId: row.organizationId }, orderBy: { createdAt: "desc" },
      }).catch(() => null);
      if (sub && sub.status !== "PAST_DUE") {
        await (this.prisma as any).subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
        accessRevoked = true;
      }
    }
    await this.logAdmin(actor, "payment_refunded", "SaasPayment", id, {
      organizationId: row.organizationId, refundMinor: amount.toString(),
      refundedTotalMinor: (already + amount).toString(), accessRevoked, reason: why,
    }, ip);
    return {
      ...updated, amountMinor: gross.toString(),
      refundedMinor: (already + amount).toString(),
      netMinor: (gross - already - amount).toString(), accessRevoked,
    };
  }

  private async paymentWithOrg(id: string) {
    const payment = await (this.prisma as any).saasPayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException("Payment not found");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: payment.organizationId } }).catch(() => null);
    return { payment, org };
  }

  /** Printable invoice (HTML) built ONLY from the payment row. */
  async paymentInvoiceHtml(id: string): Promise<string> {
    const { payment, org } = await this.paymentWithOrg(id);
    return buildInvoiceHtml({ payment, orgName: org?.name ?? payment.organizationId });
  }

  async sendInvoiceEmail(actor: any, id: string, ip?: string) {
    const { payment, org } = await this.paymentWithOrg(id);
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId: payment.organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    }).catch(() => []);
    const recipients = (memberships as any[]).map((m) => m.user?.email).filter(Boolean) as string[];
    if (recipients.length === 0) throw new BadRequestException("No OWNER/ADMIN email recipients found for this organization");
    const fmt = (minor: bigint) => (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
    const gross = BigInt(payment.amountMinor ?? 0);
    const refunded = BigInt(payment.refundedMinor ?? 0);
    const text = [
      `Invoice — ${org?.name ?? payment.organizationId}`,
      ``,
      `Invoice no: INV-${String(payment.id).slice(-8).toUpperCase()}`,
      `Date: ${new Date(payment.createdAt).toISOString().slice(0, 10)}`,
      `Method: ${payment.method}${payment.reference ? ` · Ref: ${payment.reference}` : ""}`,
      payment.periodEnd ? `Service period ends: ${new Date(payment.periodEnd).toISOString().slice(0, 10)}` : null,
      `Amount: ${payment.currency} ${fmt(gross)}`,
      refunded > 0n ? `Refunded: ${payment.currency} ${fmt(refunded)} (net ${fmt(gross - refunded)})` : null,
      ``,
      `Thank you. This invoice was generated from the platform's payment records.`,
    ].filter(Boolean).join("\n");
    const email = new EmailProvider();
    let sent = 0;
    for (const to of recipients) {
      await email.send({ to, subject: `Invoice INV-${String(payment.id).slice(-8).toUpperCase()} — ${org?.name ?? "Subscription"}`, text });
      sent++;
    }
    await this.logAdmin(actor, "invoice_emailed", "SaasPayment", id, { organizationId: payment.organizationId, recipients: sent }, ip);
    return { sent, recipients };
  }

  /** Accounting export: payments with refunds netted, CSV. */
  async exportPaymentsCsv(): Promise<string> {
    const rows = await (this.prisma as any).saasPayment.findMany({ orderBy: { createdAt: "desc" }, take: 5000 });
    const orgs = await (this.prisma as any).organization.findMany({ take: 5000 }).catch(() => []);
    const nameOf = new Map((orgs as any[]).map((o) => [o.id, o.name]));
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["date,organization,method,reference,currency,gross_minor,refunded_minor,net_minor,period_end,note"];
    for (const p of rows as any[]) {
      const gross = BigInt(p.amountMinor ?? 0);
      const refunded = BigInt(p.refundedMinor ?? 0);
      lines.push([
        new Date(p.createdAt).toISOString(), esc(nameOf.get(p.organizationId) ?? p.organizationId), esc(p.method),
        esc(p.reference ?? ""), esc(p.currency ?? "BDT"), gross.toString(), refunded.toString(),
        (gross - refunded).toString(), p.periodEnd ? new Date(p.periodEnd).toISOString().slice(0, 10) : "", esc(p.note ?? ""),
      ].join(","));
    }
    return lines.join("\n");
  }

  /** PAST_DUE board with the dunning stages actually sent
   * (from the audit record the dunning job writes). */
  async dunningBoard() {
    const subs = await (this.prisma as any).subscription.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }).catch(() => []);
    const latest = new Map<string, any>();
    for (const s of subs as any[]) if (!latest.has(s.organizationId)) latest.set(s.organizationId, s);
    const orgs = await (this.prisma as any).organization.findMany({ take: 5000 }).catch(() => []);
    const nameOf = new Map((orgs as any[]).map((o) => [o.id, o.name]));
    const entries = await (this.prisma as any).auditLog.findMany({
      where: { action: "billing.dunning_sent" }, orderBy: { createdAt: "desc" }, take: 1000,
    }).catch(() => []);
    const byOrg = new Map<string, any[]>();
    for (const e of entries as any[]) {
      if (!e.organizationId) continue;
      const list = byOrg.get(e.organizationId) ?? [];
      list.push(e); byOrg.set(e.organizationId, list);
    }
    const now = Date.now();
    const out: any[] = [];
    for (const sub of latest.values()) {
      if (sub.status !== "PAST_DUE") continue;
      const sent = byOrg.get(sub.organizationId) ?? [];
      const stages = [...new Set(sent.map((e: any) => {
        const meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata;
        return meta?.stage;
      }).filter(Boolean))].sort((a: number, b: number) => a - b);
      out.push({
        organizationId: sub.organizationId, organizationName: nameOf.get(sub.organizationId) ?? sub.organizationId,
        plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd,
        daysOverdue: sub.currentPeriodEnd ? Math.floor((now - new Date(sub.currentPeriodEnd).getTime()) / 86400000) : null,
        dunningStagesSent: stages,
        lastDunningAt: sent.length ? sent[0].createdAt : null,
      });
    }
    out.sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
    return out;
  }

  async billingSummary() {
    const prices = await planPrices(this.prisma as any);
    const subs = await (this.prisma as any).subscription.findMany({ orderBy: { createdAt: "desc" }, take: 5000 });
    const latestByOrg = new Map<string, any>();
    for (const s of subs as any[]) if (!latestByOrg.has(s.organizationId)) latestByOrg.set(s.organizationId, s);
    const orgs = await (this.prisma as any).organization.findMany({ take: 5000 });
    const nameOf = (id: string) => (orgs as any[]).find((o) => o.id === id)?.name ?? id;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    let mrr = 0; let trialing = 0;
    const perPlan: Record<string, number> = {};
    const overdue: any[] = [];
    for (const sub of latestByOrg.values()) {
      perPlan[sub.plan] = (perPlan[sub.plan] ?? 0) + 1;
      if (sub.status === "ACTIVE") mrr += prices[sub.plan] ?? 0;
      if (sub.status === "TRIALING") trialing++;
      const ended = sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) < now;
      if (sub.status === "PAST_DUE" || (ended && ["ACTIVE", "TRIALING"].includes(sub.status))) {
        overdue.push({
          organizationId: sub.organizationId, organizationName: nameOf(sub.organizationId), plan: sub.plan, status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd, daysOverdue: sub.currentPeriodEnd ? Math.floor((now.getTime() - new Date(sub.currentPeriodEnd).getTime()) / 86400000) : null,
        });
      }
    }
    const payments = await (this.prisma as any).saasPayment.findMany({ take: 10000 });
    let collectedMonth = 0n, collectedTotal = 0n;
    for (const p of payments as any[]) {
      const net = BigInt(p.amountMinor ?? 0) - BigInt(p.refundedMinor ?? 0);
      collectedTotal += net;
      if (new Date(p.createdAt) >= monthStart) collectedMonth += net;
    }
    return {
      currency: "BDT", planPricesMinor: prices, mrrMinor: String(mrr), trialingCount: trialing,
      perPlan, overdue: overdue.sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)),
      collectedThisMonthMinor: collectedMonth.toString(), collectedTotalMinor: collectedTotal.toString(),
      organizationsWithSubscription: latestByOrg.size,
    };
  }

  // ---------------- Security & TOTP (Phase D) ----------------
  async totpEnroll(actor: any, ip?: string) {
    const { generateTotpSecret, otpauthUrl } = await import("../common/totp");
    const { encryptJson } = await import("../integrations/crypto");
    const secret = generateTotpSecret();
    await (this.prisma as any).user.update({
      where: { id: actor.id },
      data: { totpSecretEncrypted: encryptJson({ secret }), totpEnabled: false },
    });
    await this.logAdmin(actor, "totp_enroll_started", "User", actor.id, {}, ip);
    // The base32 secret is returned ONCE, to its owner, so they can
    // add it to an authenticator app. It is stored AES-GCM encrypted
    // and never returned again (confirm/disable only accept codes).
    return { secret, otpauthUrl: otpauthUrl(secret, actor.email), note: "Add this to your authenticator app, then confirm with a 6-digit code. Until confirmation, two-factor stays OFF." };
  }

  private async actorTotpSecret(actor: any): Promise<string> {
    const { decryptJson } = await import("../integrations/crypto");
    const me = await (this.prisma as any).user.findUnique({ where: { id: actor.id } });
    if (!me?.totpSecretEncrypted) throw new BadRequestException("No two-factor enrolment in progress. Start enrolment first.");
    return (decryptJson(me.totpSecretEncrypted) as { secret: string }).secret;
  }

  async totpConfirm(actor: any, code: string, ip?: string) {
    const { verifyTotp } = await import("../common/totp");
    const secret = await this.actorTotpSecret(actor);
    if (!verifyTotp(secret, code)) throw new BadRequestException("That code is incorrect — check the time on your device and try again");
    await (this.prisma as any).user.update({ where: { id: actor.id }, data: { totpEnabled: true } });
    await this.logAdmin(actor, "totp_enabled", "User", actor.id, {}, ip);
    return { totpEnabled: true };
  }

  async totpDisable(actor: any, code: string, ip?: string) {
    const { verifyTotp } = await import("../common/totp");
    const secret = await this.actorTotpSecret(actor);
    if (!verifyTotp(secret, code)) throw new BadRequestException("That code is incorrect");
    await (this.prisma as any).user.update({ where: { id: actor.id }, data: { totpEnabled: false, totpSecretEncrypted: null } });
    await this.logAdmin(actor, "totp_disabled", "User", actor.id, {}, ip);
    return { totpEnabled: false, note: "Two-factor is off. A SUPER admin cannot make changes until it is enabled again (reads and enrolment still work)." };
  }

  async securityOverview(actor: any) {
    const admins = await (this.prisma as any).user.findMany({
      where: { isSuperAdmin: true },
      select: { id: true, email: true, name: true, adminTier: true, status: true, totpEnabled: true, lastLoginAt: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      me: { id: actor.id, email: actor.email, tier: actor.adminTier ?? "SUPER", totpEnabled: actor.totpEnabled === true },
      ipAllowlistConfigured: (process.env.ADMIN_IP_ALLOWLIST ?? "").trim().length > 0,
      admins,
    };
  }

  async revokeSessions(actor: any, targetUserId: string, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const target = await (this.prisma as any).user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException("User not found");
    const next = (target.tokenVersion ?? 0) + 1;
    await (this.prisma as any).user.update({ where: { id: targetUserId }, data: { tokenVersion: next } });
    await this.logAdmin(actor, "sessions_revoked", "User", targetUserId, { reason: why, self: targetUserId === actor.id }, ip);
    return { userId: targetUserId, tokenVersion: next, note: targetUserId === actor.id ? "All sessions revoked — including this one. Sign in again." : "All existing sessions for this user are revoked (checked at their next admin/tenant-guard call and at login)." };
  }

  // ---------------- Dynamic platform config (Milestone 33) ----------------
  private async rawConfigRow(key: string): Promise<any> {
    try {
      const row = await (this.prisma as any).systemSetting?.findUnique({ where: { key } });
      return row?.value ?? null;
    } catch { return null; }
  }

  /** Safe view: sources + non-secret fields + secretConfigured
   * booleans. Secret VALUES are never returned, by construction. */
  async getPlatformConfig() {
    const [llm, meta, smtp, sms, ssl, bk] = await Promise.all([
      this.rawConfigRow("llmConfig"), this.rawConfigRow("metaAppConfig"),
      this.rawConfigRow("smtpConfig"), this.rawConfigRow("smsConfig"),
      this.rawConfigRow("sslcommerzConfig"), this.rawConfigRow("bkashConfig"),
    ]);
    return {
      llm: {
        source: llm?.provider ? "admin" : (process.env.LLM_PROVIDER ? "env" : "none"),
        provider: llm?.provider ?? (process.env.LLM_PROVIDER || null),
        model: llm?.model ?? (process.env.LLM_MODEL || null),
        secretConfigured: Boolean(llm?.apiKeyEncrypted || process.env.LLM_API_KEY),
      },
      metaApp: {
        source: meta ? "admin" : "none",
        appId: meta?.appId ?? null,
        graphVersion: meta?.graphVersion ?? (process.env.META_GRAPH_VERSION || "v21.0"),
        appSecretConfigured: Boolean(meta?.appSecretEncrypted),
        adLibraryTokenConfigured: Boolean(meta?.adLibraryTokenEncrypted || process.env.FACEBOOK_AD_LIBRARY_TOKEN),
      },
      smtp: {
        source: smtp?.host ? "admin" : (process.env.SMTP_HOST ? "env" : "none"),
        host: smtp?.host ?? (process.env.SMTP_HOST || null),
        port: smtp?.port ?? (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587),
        user: smtp?.user ?? (process.env.SMTP_USER || null),
        from: smtp?.from ?? (process.env.SMTP_FROM || null),
        secretConfigured: Boolean(smtp?.passEncrypted || process.env.SMTP_PASS),
      },
      sms: {
        source: sms?.senderId ? "admin" : (process.env.SMS_API_TOKEN ? "env" : "none"),
        senderId: sms?.senderId ?? (process.env.SMS_SENDER_ID || null),
        apiUrl: sms?.apiUrl ?? (process.env.SMS_API_URL || "https://smsplus.sslwireless.com"),
        secretConfigured: Boolean(sms?.apiTokenEncrypted || process.env.SMS_API_TOKEN),
      },
      sslcommerz: {
        source: ssl?.storeId ? "admin" : (process.env.SSLCOMMERZ_STORE_ID ? "env" : "none"),
        storeId: ssl?.storeId ?? (process.env.SSLCOMMERZ_STORE_ID || null),
        sandbox: ssl ? ssl.sandbox !== false : process.env.SSLCOMMERZ_SANDBOX !== "false",
        secretConfigured: Boolean(ssl?.storePassEncrypted || process.env.SSLCOMMERZ_STORE_PASS),
      },
      bkash: {
        source: bk?.appKey ? "admin" : (process.env.BKASH_APP_KEY ? "env" : "none"),
        appKey: bk?.appKey ?? (process.env.BKASH_APP_KEY || null),
        username: bk?.username ?? (process.env.BKASH_USERNAME || null),
        sandbox: bk ? bk.sandbox !== false : process.env.BKASH_SANDBOX !== "false",
        secretConfigured: Boolean((bk?.appSecretEncrypted && bk?.passwordEncrypted) || (process.env.BKASH_APP_SECRET && process.env.BKASH_PASSWORD)),
      },
      note: "Boot secrets (DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY) stay in the server environment by design — the encryption key cannot be stored inside what it encrypts.",
    };
  }

  /** Merge a patch into one area's stored row. Secret fields: a
   * non-empty string replaces (sealed), an omitted field keeps the
   * stored secret, `clearSecret: true` removes it. `clear: true`
   * deletes the whole row (revert to env). Audited with field
   * NAMES only — values never enter the audit log. */
  async updatePlatformConfig(actor: any, area: string, patch: Record<string, unknown>, ip?: string) {
    const keyByArea: Record<string, string> = { llm: "llmConfig", meta: "metaAppConfig", smtp: "smtpConfig", sms: "smsConfig", sslcommerz: "sslcommerzConfig", bkash: "bkashConfig" };
    const key = keyByArea[area];
    if (!key) throw new BadRequestException(`Unknown config area: ${area}`);
    if (patch.clear === true) {
      await (this.prisma as any).systemSetting.deleteMany({ where: { key } });
      await refreshPlatformConfig(this.prisma as any);
      await this.logAdmin(actor, "platform_config_cleared", "SystemSetting", key, { area }, ip);
      return this.getPlatformConfig();
    }
    const current: Record<string, any> = (await this.rawConfigRow(key)) ?? {};
    const next: Record<string, any> = { ...current };
    const changed: string[] = [];
    const setField = (field: string, value: unknown) => {
      if (value === undefined) return;
      next[field] = value; changed.push(field);
    };
    const setSecret = (field: string, encryptedField: string, value: unknown, clearSecret: unknown) => {
      if (clearSecret === true) { delete next[encryptedField]; changed.push(`${field} (cleared)`); return; }
      if (typeof value === "string" && value.length > 0) { next[encryptedField] = seal(value); changed.push(field); }
    };
    if (area === "llm") {
      if (patch.provider !== undefined) {
        const p = String(patch.provider).toLowerCase();
        if (!["openai", "anthropic", "gemini", "dev", ""].includes(p)) throw new BadRequestException("provider must be openai | anthropic | gemini | dev");
        setField("provider", p);
      }
      setField("model", patch.model === undefined ? undefined : String(patch.model));
      setSecret("apiKey", "apiKeyEncrypted", patch.apiKey, patch.clearSecret);
    } else if (area === "meta") {
      setField("appId", patch.appId === undefined ? undefined : String(patch.appId));
      if (patch.graphVersion !== undefined) {
        const v = String(patch.graphVersion);
        if (!/^v\d+\.\d+$/.test(v)) throw new BadRequestException("graphVersion must look like v21.0");
        setField("graphVersion", v);
      }
      setSecret("appSecret", "appSecretEncrypted", patch.appSecret, patch.clearSecret);
      setSecret("adLibraryToken", "adLibraryTokenEncrypted", patch.adLibraryToken, undefined);
    } else if (area === "smtp") {
      setField("host", patch.host === undefined ? undefined : String(patch.host));
      if (patch.port !== undefined) {
        const port = Number(patch.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException("port must be 1-65535");
        setField("port", port);
      }
      setField("user", patch.user === undefined ? undefined : String(patch.user));
      setField("from", patch.from === undefined ? undefined : String(patch.from));
      setSecret("pass", "passEncrypted", patch.pass, patch.clearSecret);
    } else if (area === "sms") {
      setField("senderId", patch.senderId === undefined ? undefined : String(patch.senderId));
      setField("apiUrl", patch.apiUrl === undefined ? undefined : String(patch.apiUrl));
      setSecret("apiToken", "apiTokenEncrypted", patch.apiToken, patch.clearSecret);
    } else if (area === "sslcommerz") {
      setField("storeId", patch.storeId === undefined ? undefined : String(patch.storeId));
      if (patch.sandbox !== undefined) setField("sandbox", patch.sandbox === true);
      setSecret("storePass", "storePassEncrypted", patch.storePass, patch.clearSecret);
    } else if (area === "bkash") {
      setField("appKey", patch.appKey === undefined ? undefined : String(patch.appKey));
      setField("username", patch.username === undefined ? undefined : String(patch.username));
      if (patch.sandbox !== undefined) setField("sandbox", patch.sandbox === true);
      setSecret("appSecret", "appSecretEncrypted", patch.appSecret, patch.clearSecret);
      setSecret("password", "passwordEncrypted", patch.password, undefined);
    }
    await (this.prisma as any).systemSetting.upsert({
      where: { key }, create: { key, value: next, updatedById: actor.id }, update: { value: next, updatedById: actor.id },
    });
    await refreshPlatformConfig(this.prisma as any);
    await this.logAdmin(actor, "platform_config_updated", "SystemSetting", key, { area, changed }, ip);
    return this.getPlatformConfig();
  }

  /** A REAL minimal completion against the configured provider.
   * Success requires the provider's own response; failures surface
   * the provider's error verbatim. The dev adapter is reported as
   * "not a real LLM", never as a pass. */
  async testLlm() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveLlmConfig();
    if (cfg.source === "none" || !cfg.provider || cfg.provider === "dev") {
      throw new BadRequestException("No real LLM is configured. Set a provider + API key above (or LLM_PROVIDER/LLM_API_KEY in env) first.");
    }
    const provider = buildLlmProvider(cfg.provider, cfg.apiKey, cfg.model);
    const started = Date.now();
    try {
      const result = await Promise.race([
        provider.complete([{ role: "user", content: "Reply with the single word: pong" }], { maxTokens: 16 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM test timed out after 30s")), 30_000)),
      ]);
      return { ok: true, provider: cfg.provider, model: result.model, source: cfg.source, latencyMs: Date.now() - started, sample: String(result.text).slice(0, 80) };
    } catch (e) {
      throw new BadRequestException(`LLM test did NOT succeed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  async testEmail(to: string) {
    if (!to?.includes("@")) throw new BadRequestException("A valid recipient email is required for the test");
    await refreshPlatformConfig(this.prisma as any);
    try {
      const out = await new EmailProvider().send({
        to, subject: "Qosprey AI Marketing — SMTP test",
        text: "This is a test email from the Admin Console. If you received it, the platform SMTP configuration works. No action is needed.",
      });
      return { ok: true, providerMessageId: out.providerMessageId };
    } catch (e) {
      throw new BadRequestException(`Email test did NOT succeed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  async testSms(to: string) {
    const msisdn = normalizeBdPhone(to ?? "") ?? to;
    if (!msisdn) throw new BadRequestException("A recipient phone number is required for the test");
    await refreshPlatformConfig(this.prisma as any);
    try {
      const out = await new SmsProvider().send({ to: msisdn, text: "Qosprey AI Marketing: SMS configuration test. No action needed.", reference: `admin-test-${Date.now()}` });
      return { ok: true, providerMessageId: out.providerMessageId };
    } catch (e) {
      throw new BadRequestException(`SMS test did NOT succeed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  // ---------------- Phase A1 (Milestone 37): Operator Visibility++ ----------------
  // Every number below is computed from stored rows. Where a
  // figure is a snapshot or a heuristic, the response says so
  // in its shape (inputs are returned alongside scores).

  private monthKey(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  private async latestSubscriptions(): Promise<Map<string, any>> {
    const subs = await (this.prisma as any).subscription.findMany({ orderBy: { createdAt: "desc" } }).catch(() => []);
    const latest = new Map<string, any>();
    for (const s of subs as any[]) if (!latest.has(s.organizationId)) latest.set(s.organizationId, s);
    return latest;
  }

  async analyticsSeries(monthsRaw?: number) {
    const months = Math.min(24, Math.max(3, Number(monthsRaw ?? 12) || 12));
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const keys: string[] = [];
    for (let i = 0; i < months; i++) keys.push(this.monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
    const blank = () => ({ collectedMinor: 0n, newOrgs: 0, newUsers: 0, newSubscriptions: 0, orders: 0, orderRevenueMinor: 0n });
    const buckets = new Map<string, ReturnType<typeof blank>>(keys.map((k) => [k, blank()]));
    const add = (at: Date, fn: (b: ReturnType<typeof blank>) => void) => {
      const b = buckets.get(this.monthKey(at));
      if (b) fn(b);
    };
    const since = { createdAt: { gte: start } };
    const [payments, orgs, users, subs, orders] = await Promise.all([
      (this.prisma as any).saasPayment.findMany({ where: since }).catch(() => []),
      (this.prisma as any).organization.findMany({ where: since }).catch(() => []),
      (this.prisma as any).user.findMany({ where: since }).catch(() => []),
      (this.prisma as any).subscription.findMany({ where: since }).catch(() => []),
      (this.prisma as any).order.findMany({ where: since, take: 20000 }).catch(() => []),
    ]);
    for (const p of payments as any[]) add(new Date(p.createdAt), (b) => { b.collectedMinor += BigInt(p.amountMinor ?? 0) - BigInt(p.refundedMinor ?? 0); });
    for (const o of orgs as any[]) add(new Date(o.createdAt), (b) => { b.newOrgs += 1; });
    for (const u of users as any[]) add(new Date(u.createdAt), (b) => { b.newUsers += 1; });
    for (const s of subs as any[]) add(new Date(s.createdAt), (b) => { b.newSubscriptions += 1; });
    for (const o of orders as any[]) {
      if (o.status === "cancelled" || o.status === "refunded") continue;
      add(new Date(o.createdAt), (b) => { b.orders += 1; b.orderRevenueMinor += BigInt(o.totalMinor ?? 0); });
    }
    const prices = await planPrices(this.prisma as any);
    const latest = await this.latestSubscriptions();
    let mrr = 0n, activeSubs = 0, trialing = 0, pastDue = 0, paidOrgs = 0;
    for (const s of latest.values()) {
      if (s.status === "ACTIVE") { activeSubs += 1; mrr += BigInt(prices[s.plan] ?? 0); }
      if (s.status === "TRIALING") trialing += 1;
      if (s.status === "PAST_DUE") pastDue += 1;
      if (s.plan !== "FREE" && (s.status === "ACTIVE" || s.status === "PAST_DUE")) paidOrgs += 1;
    }
    const totalOrgs = latest.size;
    return {
      months: keys.map((k) => {
        const b = buckets.get(k)!;
        return { month: k, collectedMinor: b.collectedMinor.toString(), newOrgs: b.newOrgs, newUsers: b.newUsers, newSubscriptions: b.newSubscriptions, orders: b.orders, orderRevenueMinor: b.orderRevenueMinor.toString() };
      }),
      current: {
        mrrMinor: mrr.toString(), activeSubscriptions: activeSubs, trialing, pastDue,
        organizationsWithSubscription: totalOrgs,
        paidOrganizations: paidOrgs,
        // Snapshot ratio (orgs on a paid plan today / orgs with
        // any subscription) — labelled as such in the UI; it is
        // NOT a cohort conversion rate.
        paidSharePercent: totalOrgs > 0 ? Math.round((paidOrgs / totalOrgs) * 1000) / 10 : null,
      },
    };
  }

  async analyticsTopTenants(limitRaw?: number) {
    const limit = Math.min(25, Math.max(1, Number(limitRaw ?? 10) || 10));
    const since30 = new Date(Date.now() - 30 * 86400000);
    const orgs = await (this.prisma as any).organization.findMany({ take: 200, orderBy: { createdAt: "asc" } }).catch(() => []);
    const latest = await this.latestSubscriptions();
    const rows: any[] = [];
    for (const org of orgs as any[]) {
      const [orders, usage, payments, members] = await Promise.all([
        (this.prisma as any).order.findMany({ where: { organizationId: org.id, createdAt: { gte: since30 } }, take: 5000 }).catch(() => []),
        (this.prisma as any).aIUsageRecord.findMany({ where: { organizationId: org.id, createdAt: { gte: since30 } } }).catch(() => []),
        (this.prisma as any).saasPayment.findMany({ where: { organizationId: org.id } }).catch(() => []),
        (this.prisma as any).membership.count({ where: { organizationId: org.id, status: "ACTIVE" } }).catch(() => 0),
      ]);
      let revenue = 0n, orderCount = 0;
      for (const o of orders as any[]) {
        if (o.status === "cancelled" || o.status === "refunded") continue;
        orderCount += 1; revenue += BigInt(o.totalMinor ?? 0);
      }
      let tokens = 0;
      for (const u of usage as any[]) tokens += Number(u.inputTokens ?? 0) + Number(u.outputTokens ?? 0);
      let collected = 0n;
      for (const p of payments as any[]) collected += BigInt(p.amountMinor ?? 0);
      const sub = latest.get(org.id);
      rows.push({
        organizationId: org.id, name: org.name, status: org.status,
        plan: sub?.plan ?? null, subscriptionStatus: sub?.status ?? null,
        members, orders30d: orderCount, orderRevenue30dMinor: revenue.toString(),
        aiTokens30d: tokens, collectedTotalMinor: collected.toString(),
      });
    }
    rows.sort((a, b) => Number(BigInt(b.orderRevenue30dMinor) - BigInt(a.orderRevenue30dMinor)) || Number(BigInt(b.collectedTotalMinor) - BigInt(a.collectedTotalMinor)));
    return rows.slice(0, limit);
  }

  /** Heuristic triage score. Deductions are returned verbatim
   * so the operator sees exactly why a tenant scored low. */
  async analyticsHealthScores() {
    const since24 = new Date(Date.now() - 24 * 3600000);
    const orgs = await (this.prisma as any).organization.findMany({ take: 100, orderBy: { createdAt: "asc" } }).catch(() => []);
    const latest = await this.latestSubscriptions();
    const out: any[] = [];
    for (const org of orgs as any[]) {
      const deductions: { reason: string; points: number }[] = [];
      const sub = latest.get(org.id);
      if (sub?.status === "PAST_DUE") deductions.push({ reason: "সাবস্ক্রিপশন PAST_DUE", points: 40 });
      if (sub?.status === "CANCELLED") deductions.push({ reason: "সাবস্ক্রিপশন CANCELLED", points: 60 });
      if (!sub) deductions.push({ reason: "কোনো সাবস্ক্রিপশন নেই", points: 20 });
      const [errRuns, lastOrder, lastUsage, integrations] = await Promise.all([
        (this.prisma as any).automationRun.count({ where: { organizationId: org.id, status: "error", createdAt: { gte: since24 } } }).catch(() => 0),
        (this.prisma as any).order.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" } }).catch(() => null),
        (this.prisma as any).aIUsageRecord.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" } }).catch(() => null),
        (this.prisma as any).integration.count({ where: { organizationId: org.id } }).catch(() => 0),
      ]);
      if (errRuns > 0) deductions.push({ reason: `গত ২৪ ঘণ্টায় ${errRuns}টি Automation Error`, points: Math.min(24, errRuns * 8) });
      const lastActivity = [lastOrder?.createdAt, lastUsage?.createdAt, org.updatedAt ?? org.createdAt]
        .filter(Boolean).map((d: any) => new Date(d).getTime());
      const daysIdle = lastActivity.length ? Math.floor((Date.now() - Math.max(...lastActivity)) / 86400000) : 999;
      if (daysIdle >= 30) deductions.push({ reason: `${daysIdle} দিন কোনো কার্যকলাপ নেই`, points: 25 });
      else if (daysIdle >= 14) deductions.push({ reason: `${daysIdle} দিন কোনো কার্যকলাপ নেই`, points: 15 });
      else if (daysIdle >= 7) deductions.push({ reason: `${daysIdle} দিন কোনো কার্যকলাপ নেই`, points: 8 });
      if (integrations === 0) deductions.push({ reason: "কোনো ইন্টিগ্রেশন কানেক্ট নেই", points: 10 });
      const score = Math.max(0, Math.min(100, 100 - deductions.reduce((a, d) => a + d.points, 0)));
      out.push({
        organizationId: org.id, name: org.name, score,
        band: score >= 75 ? "good" : score >= 45 ? "watch" : "risk",
        plan: sub?.plan ?? null, subscriptionStatus: sub?.status ?? null,
        daysIdle, automationErrors24h: errRuns, deductions,
      });
    }
    out.sort((a, b) => a.score - b.score);
    return { heuristic: true, scores: out };
  }

  async analyticsAiCost() {
    const ratesRow = await this.rawConfigRow("aiCostRates");
    const rates: Record<string, number> = (ratesRow?.ratesMinorPerMillion ?? {}) as Record<string, number>;
    const since30 = new Date(Date.now() - 30 * 86400000);
    const usage = await (this.prisma as any).aIUsageRecord.findMany({ where: { createdAt: { gte: since30 } }, take: 20000 }).catch(() => []);
    const orgs = await (this.prisma as any).organization.findMany({ take: 500 }).catch(() => []);
    const nameOf = new Map((orgs as any[]).map((o) => [o.id, o.name]));
    const groups = new Map<string, any>();
    for (const u of usage as any[]) {
      const key = `${u.organizationId}|${u.provider}`;
      const g = groups.get(key) ?? { organizationId: u.organizationId, organizationName: nameOf.get(u.organizationId) ?? u.organizationId, provider: u.provider, calls: 0, tokens: 0, estimatedTokens: 0 };
      g.calls += 1;
      const t = Number(u.inputTokens ?? 0) + Number(u.outputTokens ?? 0);
      if (u.estimated) g.estimatedTokens += t; else g.tokens += t;
      groups.set(key, g);
    }
    const rows = [...groups.values()].map((g) => {
      const rate = rates[g.provider];
      return {
        ...g,
        rateMinorPerMillion: rate ?? null,
        // Money exists ONLY when the operator set a rate; the
        // UI labels it an estimate. Dev-adapter (estimated)
        // tokens never enter the cost.
        estimatedCostMinor: rate != null ? Math.round((g.tokens / 1_000_000) * rate) : null,
      };
    }).sort((a, b) => b.tokens - a.tokens);
    return { rates, rows, note: "Costs are estimates from operator-set rates × real (non-estimated) token counts." };
  }

  async updateAiCostRates(actor: any, ratesRaw: Record<string, unknown>, ip?: string) {
    const rates: Record<string, number> = {};
    for (const [provider, value] of Object.entries(ratesRaw ?? {})) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`Rate for ${provider} must be a non-negative number (minor units per 1M tokens)`);
      if (n > 0) rates[provider] = Math.round(n);
    }
    await (this.prisma as any).systemSetting.upsert({
      where: { key: "aiCostRates" },
      create: { key: "aiCostRates", value: { ratesMinorPerMillion: rates }, updatedById: actor.id },
      update: { value: { ratesMinorPerMillion: rates }, updatedById: actor.id },
    });
    await this.logAdmin(actor, "ai_cost_rates_updated", "SystemSetting", "aiCostRates", { providers: Object.keys(rates) }, ip);
    return this.analyticsAiCost();
  }

  async orgHistory(organizationId: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const [audit, payments, sub] = await Promise.all([
      (this.prisma as any).auditLog.findMany({
        where: { OR: [{ organizationId }, { entityType: "Organization", entityId: organizationId }] },
        orderBy: { createdAt: "desc" }, take: 100,
      }).catch(() => []),
      (this.prisma as any).saasPayment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
      (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }).catch(() => null),
    ]);
    const events: any[] = [];
    for (const a of audit as any[]) {
      events.push({ at: a.createdAt, kind: "audit", title: a.action, detail: a.entityType ? `${a.entityType}${a.entityId ? ` · ${String(a.entityId).slice(0, 8)}…` : ""}` : null });
    }
    for (const p of payments as any[]) {
      events.push({ at: p.createdAt, kind: "payment", title: `পেমেন্ট গৃহীত (${p.method})`, detail: `${BigInt(p.amountMinor ?? 0).toString()} minor${p.reference ? ` · ${p.reference}` : ""}` });
    }
    if (sub) {
      events.push({ at: sub.updatedAt ?? sub.createdAt, kind: "subscription", title: `সাবস্ক্রিপশন: ${sub.plan} · ${sub.status}`, detail: sub.currentPeriodEnd ? `মেয়াদ শেষ ${new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)}` : null });
    }
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { organizationId, organizationName: org.name, events: events.slice(0, 100) };
  }
}
