import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { existsSync, readdirSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { dirname, join } from "node:path";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { platformSetting, PLAN_TIERS, planPrices, planYearlyPrices, planLimits, PLAN_LIMIT_FIELDS } from "../common/platform-settings";
import { KNOWN_FLAG_KEYS, planFlagDefaults } from "../common/feature-flags";
import { referralConfig, maybeRewardReferral } from "../common/referral";
import {
  seal, unseal, refreshPlatformConfig, getPlatformConfigSync,
  effectiveLlmConfig, effectiveImageConfig,
  effectiveSslcommerzConfig, effectiveBkashConfig, effectiveTiktokAppConfig, effectiveGoogleAppConfig, effectiveLinkedinAppConfig,
  sslcommerzBase, bkashBase, socialOAuthRedirectUri,
  type BkashConfig, type SslcommerzConfig,
} from "../common/platform-config";
import { rateLimitStats } from "../common/throttler.guard";
import { storageUsageForOrg } from "../common/storage-usage";
import { buildLlmProvider } from "../ai/llm/llm.factory";
import { buildImageProvider } from "../ai/images/image.factory";
import { EmailProvider } from "../messaging/email.provider";
import { buildInvoiceHtml, buildSaasInvoicePdf, saasInvoiceData } from "../payments/payments.service";
import { SmsProvider, normalizeBdPhone } from "../messaging/sms.provider";
import { AuditService } from "../audit/audit.service";
import { buildOrgDataBundle } from "../organizations/org-data-export";
import { issueAdminToken } from "../common/admin-token";
import { computeAdAccountHealth } from "../ads/ad-health";
import { SocialHealthService } from "../social/social-health.service";
import { SocialPublishService } from "../social/social-publish.service";
import { AdsService } from "../ads/ads.service";
import { publicMediaServingEnabled } from "../storage/media-url";

const ADMIN_TIERS = ["SUPER", "SUPPORT", "FINANCE"] as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Milestone 38: view-as token signing (AuthModule's JwtModule).
    @Optional() private readonly jwt?: JwtService,
    // AB3 (AN13): operator retry delegations. Optional so older
    // spec constructions keep compiling; AdminModule wires the
    // real services via SocialModule / AdsModule imports. When a
    // service is absent the AN13 actions refuse honestly instead
    // of fabricating a retry.
    @Optional() private readonly socialHealth?: SocialHealthService,
    @Optional() private readonly socialPublish?: SocialPublishService,
    @Optional() private readonly ads?: AdsService,
  ) {}

  /** Milestone 57: dead-letter queue visibility (replay is
   * delegated by the controller to AutomationService). */
  async listDlq() {
    const rows = await (this.prisma as any).deadLetterJob.findMany({
      orderBy: { createdAt: "desc" }, take: 50,
    }).catch(() => []);
    return { entries: rows, pending: rows.filter((r: any) => !r.replayedAt).length };
  }

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

  /**
   * ADX3 (Admin UX DB1): the ONLY new endpoint of the ADX package —
   * the counts behind the sidebar badges and the Attention Bell.
   * Honesty contract (docs/admin-ux-architecture.md §4–§5): every
   * field is counted from real rows, and a field that cannot be
   * sourced is OMITTED from the response — never zero-filled, never
   * estimated. The client renders nothing for an absent field.
   */
  async navCounts(now = new Date()) {
    const out: Record<string, number> = {};
    const since24h = new Date(now.getTime() - 86400000);
    const [payouts, tickets, failed, alerts, overdue] = await Promise.allSettled([
      // PayoutRequest.status: pending | approved | paid | rejected | cancelled
      (this.prisma as any).payoutRequest.count({ where: { status: "pending" } }),
      // SupportTicket.status: open | pending | resolved | closed —
      // both non-terminal states need an operator (an admin reply
      // moves open → pending; the tenant can re-open a pending one).
      (this.prisma as any).supportTicket.count({ where: { status: { in: ["open", "pending"] } } }),
      // Failed jobs — the same definition as overview() (FAILED
      // sync jobs in 24h + automation runs in "error" in 24h).
      // Both use `startedAt`: overview() originally filtered
      // SyncJob by `updatedAt`, a field the model does not have,
      // which silently zeroed its count; DB2 FIX-0 corrected
      // overview() to this same field. All-or-nothing: a partial
      // sum would UNDERSTATE failures, so either query failing
      // omits the whole field.
      Promise.all([
        (this.prisma as any).syncJob.count({ where: { status: "FAILED", startedAt: { gte: since24h } } }),
        (this.prisma as any).automationRun.count({ where: { status: "error", createdAt: { gte: since24h } } }),
      ]).then(([s, a]) => s + a),
      // Alerts are computed, not stored — reuse alertsBoard() so the
      // badge can never disagree with the Alerts page.
      this.alertsBoard().then((a) => a.length),
      // Overdue = exactly the list the Billing page shows; reuse
      // billingSummary() instead of re-implementing its definition.
      this.billingSummary().then((b) => b.overdue.length),
    ]);
    if (payouts.status === "fulfilled") out.pendingPayouts = payouts.value;
    if (tickets.status === "fulfilled") out.openTickets = tickets.value;
    if (failed.status === "fulfilled") out.failedJobs24h = failed.value;
    if (alerts.status === "fulfilled") out.activeAlerts = alerts.value;
    if (overdue.status === "fulfilled") out.overdueSubscriptions = overdue.value;
    return out;
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
      // DB2 FIX-0: the SyncJob model has no `updatedAt` field (schema:
      // startedAt/completedAt only). Filtering by it made Prisma throw
      // and the .catch(() => 0) below silently zeroed the live
      // failed-sync count. `startedAt` is the field navCounts() and
      // every other failed-sync query in this service already use.
      (this.prisma as any).syncJob.count({ where: { status: "FAILED", startedAt: { gte: since24h } } }).catch(() => 0),
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
    // GC21 (GB9): the merchant-verification review surface —
    // the submitted BusinessProfile (trade licence, business
    // address, contacts) plus recorded storage usage. Profile
    // money fields are BigInt; they cross as strings, the same
    // rule as OrganizationsService.profileJson.
    const profileRaw = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId: id } }).catch(() => null) ?? null;
    let businessProfile: any = null;
    if (profileRaw) {
      businessProfile = { ...profileRaw };
      for (const k of ["monthlyBudgetMinor", "deliveryChargeInsideMinor", "deliveryChargeOutsideMinor", "freeDeliveryAboveMinor", "minOrderMinor", "codMaxOrderMinor", "codAdvanceRequiredAboveMinor"]) {
        if (typeof businessProfile[k] === "bigint") businessProfile[k] = (businessProfile[k] as bigint).toString();
      }
    }
    const storage = await storageUsageForOrg(this.prisma as any, id);
    return {
      ...org,
      // AB8 (AX24): explicit so the detail payload always carries
      // the flag (the spread above already rides the row's value).
      whiteLabel: org.whiteLabel === true,
      creditMinor: BigInt(org.creditMinor ?? 0).toString(),
      members: memberships.map((m: any) => ({ ...m, user: users.find((u: any) => u.id === m.userId) ?? null })),
      integrations: integrations.map((i: any) => ({ id: i.id, provider: i.provider, status: i.status })),
      subscription,
      counts: { products, orders, conversations, campaigns },
      businessProfile,
      storageBytes: storage.storageBytes,
      storageAssetCount: storage.assetCount,
      storageMeteredFrom: storage.meteredFrom,
    };
  }

  /**
   * GC21 (GB9): merchant verification review. Only a `pending`
   * submission can be decided. Approve → status "verified"
   * (note optional). Reject → status "rejected" and the note is
   * REQUIRED — it is shown to the merchant verbatim so they know
   * what to fix before resubmitting. Audited via the standard
   * admin audit pattern (logAdmin).
   */
  async reviewOrgVerification(actor: any, id: string, decision: string, note?: string, ip?: string) {
    if (!["approve", "reject"].includes(decision)) throw new BadRequestException("decision must be approve or reject");
    const org = await (this.prisma as any).organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException("Organization not found");
    if (org.verificationStatus !== "pending") {
      throw new BadRequestException("শুধু জমা পড়া (pending) আবেদনই রিভিউ করা যায়");
    }
    const trimmedNote = typeof note === "string" ? note.trim() : "";
    if (decision === "reject" && !trimmedNote) {
      throw new BadRequestException("Reject করলে কারণ/নোট লিখতে হবে — মার্চেন্ট সেটি দেখে ঠিক করে আবার জমা দেবেন");
    }
    const from = org.verificationStatus;
    const to = decision === "approve" ? "verified" : "rejected";
    const updated = await (this.prisma as any).organization.update({
      where: { id },
      data: { verificationStatus: to, verificationNote: trimmedNote || null },
    });
    await this.logAdmin(actor, "org_verification_review", "Organization", id, { from, to, decision, note: trimmedNote || undefined }, ip);
    return {
      id, verificationStatus: updated.verificationStatus,
      verificationNote: updated.verificationNote ?? null,
      verificationSubmittedAt: updated.verificationSubmittedAt ?? null,
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

  private auditWhere(filters: { action?: string; userId?: string; organizationId?: string; entityType?: string; dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (filters.action) where.action = { startsWith: filters.action };
    if (filters.userId) where.userId = filters.userId;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.entityType) where.entityType = filters.entityType;
    const createdAt: any = {};
    if (filters.dateFrom) {
      const d = new Date(filters.dateFrom);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (filters.dateTo) {
      const d = new Date(filters.dateTo);
      if (!Number.isNaN(d.getTime())) createdAt.lte = d;
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
    return where;
  }

  async auditTrail(filters: { action?: string; userId?: string; organizationId?: string; entityType?: string; dateFrom?: string; dateTo?: string; take?: number }) {
    const where = this.auditWhere(filters);
    return (this.prisma as any).auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(200, filters.take ?? 50) });
  }

  async exportAuditCsv(filters: { action?: string; userId?: string; organizationId?: string; entityType?: string; dateFrom?: string; dateTo?: string }): Promise<string> {
    const where = this.auditWhere(filters);
    const rows = await (this.prisma as any).auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 1000 }).catch(() => []);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["createdAt,action,entityType,entityId,organizationId,userId,ipAddress,metadata"];
    for (const r of rows as any[]) {
      const meta = r.metadata == null ? "" : JSON.stringify(r.metadata);
      lines.push([
        r.createdAt ? new Date(r.createdAt).toISOString() : "",
        esc(r.action), esc(r.entityType), esc(r.entityId ?? ""), esc(r.organizationId ?? ""), esc(r.userId ?? ""), esc(r.ipAddress ?? ""), esc(meta),
      ].join(","));
    }
    return lines.join("\n");
  }

  // ---------------- Platform settings, announcements, flags ----------------
  static readonly SETTING_KEYS = ["maintenanceMode", "signupOpen", "supportContact", "killSwitches", "planPrices", "planYearlyPrices", "planLimits", "planFlagDefaults", "maintenanceWindow", "auditRetentionDays"] as const;

  async getSettings() {
    const rawPlanLimits = await platformSetting(this.prisma as any, "planLimits");
    const out: Record<string, unknown> = {
      maintenanceMode: false, signupOpen: true, supportContact: "",
      killSwitches: { aiDisabledOrgIds: [], broadcastsPaused: false },
      planPrices: await planPrices(this.prisma as any),
      planYearlyPrices: await planYearlyPrices(this.prisma as any),
      planLimits: await planLimits(this.prisma as any),
      planLimitsStored: rawPlanLimits ?? null,
      // AA7: the sparse plan-flag-default map, already sanitized by
      // the reader (unknown flags/tiers/non-booleans dropped) — the
      // console matrix renders explicit entries from exactly this.
      planFlagDefaults: await planFlagDefaults(this.prisma as any),
      maintenanceWindow: null, auditRetentionDays: 365,
    };
    for (const key of AdminService.SETTING_KEYS) {
      if (key === "planLimits") continue; // already merged above; raw is in planLimitsStored
      if (key === "planFlagDefaults") continue; // sanitized sparse map already set above
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
      if (key === "planPrices" || key === "planYearlyPrices") {
        const pp = value as any;
        if (!pp || typeof pp !== "object") throw new BadRequestException(`${key} must be an object`);
        for (const tier of PLAN_TIERS) {
          if (pp[tier] !== undefined && (typeof pp[tier] !== "number" || pp[tier] < 0)) {
            throw new BadRequestException(`${key}.${tier} must be a non-negative number (minor units)`);
          }
        }
      }
      if (key === "planLimits") {
        const pl = value as any;
        if (!pl || typeof pl !== "object" || Array.isArray(pl)) throw new BadRequestException("planLimits must be an object");
        for (const tier of PLAN_TIERS) {
          if (pl[tier] === undefined) continue;
          const tierVal = pl[tier];
          if (!tierVal || typeof tierVal !== "object" || Array.isArray(tierVal)) {
            throw new BadRequestException(`planLimits.${tier} must be an object`);
          }
          for (const field of PLAN_LIMIT_FIELDS) {
            if (tierVal[field] !== undefined && (!Number.isInteger(tierVal[field]) || tierVal[field] < 0)) {
              throw new BadRequestException(`planLimits.${tier}.${field} must be a non-negative integer`);
            }
          }
        }
      }
      if (key === "planFlagDefaults") {
        const pfd = value as any;
        if (!pfd || typeof pfd !== "object" || Array.isArray(pfd)) throw new BadRequestException("planFlagDefaults must be an object");
        for (const [flag, perTier] of Object.entries(pfd)) {
          if (!(KNOWN_FLAG_KEYS as readonly string[]).includes(flag)) {
            throw new BadRequestException(`planFlagDefaults: unknown flag "${flag}" (known: ${KNOWN_FLAG_KEYS.join(", ")})`);
          }
          if (!perTier || typeof perTier !== "object" || Array.isArray(perTier)) {
            throw new BadRequestException(`planFlagDefaults.${flag} must be an object of tier -> boolean`);
          }
          for (const [tier, v] of Object.entries(perTier as Record<string, unknown>)) {
            if (!(PLAN_TIERS as readonly string[]).includes(tier)) {
              throw new BadRequestException(`planFlagDefaults.${flag}: unknown tier "${tier}"`);
            }
            if (typeof v !== "boolean") throw new BadRequestException(`planFlagDefaults.${flag}.${tier} must be a boolean`);
          }
        }
      }
      if (key === "maintenanceWindow") {
        if (value !== null) {
          const w = value as any;
          if (!w || typeof w !== "object" || !w.startsAt || !w.endsAt || Number.isNaN(Date.parse(w.startsAt)) || Number.isNaN(Date.parse(w.endsAt))) {
            throw new BadRequestException("maintenanceWindow must be null or { startsAt, endsAt, message?, hardLockout? } with valid ISO dates");
          }
          if (new Date(w.endsAt).getTime() <= new Date(w.startsAt).getTime()) {
            throw new BadRequestException("maintenanceWindow.endsAt must be after startsAt");
          }
          if (w.message !== undefined && typeof w.message !== "string") throw new BadRequestException("maintenanceWindow.message must be a string");
          if (w.hardLockout !== undefined && typeof w.hardLockout !== "boolean") throw new BadRequestException("maintenanceWindow.hardLockout must be a boolean");
        }
      }
      if (key === "auditRetentionDays") {
        if (typeof value !== "number" || value < 30 || value > 3650) {
          throw new BadRequestException("auditRetentionDays must be a number between 30 and 3650");
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

  // ---------------- Admin Next AB3 / AN14(a): Plan limits clear-to-default ----
  // AA4 made plan limits editable but offered no way back: the
  // stored sparse map could only grow. This removes ONE tier's
  // entry from the stored planLimits map, so planLimits()
  // resolution for that tier falls back to the pure
  // DEFAULT_PLAN_LIMITS — other tiers' entries are untouched.
  // A tier with no stored entry is already on defaults: the
  // action reports cleared:false honestly and mutates nothing.

  async clearPlanLimits(actor: any, tier: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    if (!(PLAN_TIERS as readonly string[]).includes(tier)) {
      throw new BadRequestException(`Unknown plan tier "${tier}" (known: ${PLAN_TIERS.join(", ")})`);
    }
    const storedRaw = await platformSetting(this.prisma as any, "planLimits");
    const stored: Record<string, unknown> = storedRaw && typeof storedRaw === "object" && !Array.isArray(storedRaw)
      ? { ...(storedRaw as Record<string, unknown>) }
      : {};
    const before = stored[tier] ?? null;
    if (before === null) {
      await this.logAdmin(actor, "plan_limits_clear_noop", "SystemSetting", "planLimits", { tier, reason: why, cleared: false }, ip);
      return {
        tier, cleared: false,
        note: "এই প্ল্যানে কোনো Setting entry নেই — ইতিমধ্যে Code Default-ই কার্যকর আছে।",
        planLimits: await planLimits(this.prisma as any),
        planLimitsStored: Object.keys(stored).length ? stored : null,
      };
    }
    delete stored[tier];
    await (this.prisma as any).systemSetting.upsert({
      where: { key: "planLimits" },
      create: { key: "planLimits", value: stored as any, updatedById: actor.id },
      update: { value: stored as any, updatedById: actor.id },
    });
    await this.logAdmin(actor, "plan_limits_cleared", "SystemSetting", "planLimits", {
      tier, reason: why, cleared: true, before, after: null,
    }, ip);
    return {
      tier, cleared: true,
      planLimits: await planLimits(this.prisma as any),
      planLimitsStored: Object.keys(stored).length ? stored : null,
    };
  }

  /** Milestone 41: the valid announcement audiences. */
  static readonly ANNOUNCEMENT_AUDIENCES = ["all", "trialing", "past_due", ...PLAN_TIERS.map((t) => `plan_${t}`)];

  /** The audience tags an organization currently matches. */
  private async orgAudienceTags(organizationId: string): Promise<string[]> {
    const tags = ["all"];
    const sub = await (this.prisma as any).subscription?.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (sub) {
      tags.push(`plan_${sub.plan}`);
      if (sub.status === "TRIALING") tags.push("trialing");
      if (sub.status === "PAST_DUE") tags.push("past_due");
    }
    return tags;
  }

  async publicStatus(organizationId?: string) {
    const settings = await this.getSettings();
    const now = new Date();
    const announcements = await (this.prisma as any).announcement?.findMany?.({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 10 }).catch(() => []) ?? [];
    const inWindow = (announcements as any[]).filter((a) => (!a.startsAt || new Date(a.startsAt) <= now) && (!a.endsAt || new Date(a.endsAt) >= now));
    let current: any = null;
    if (organizationId) {
      const tags = await this.orgAudienceTags(organizationId);
      // Targeted announcements win over the global one.
      current = inWindow.find((a) => (a.audience ?? "all") !== "all" && tags.includes(a.audience ?? "all"))
        ?? inWindow.find((a) => (a.audience ?? "all") === "all")
        ?? null;
    } else {
      current = inWindow.find((a) => (a.audience ?? "all") === "all") ?? null;
    }
    const w = (settings as any).maintenanceWindow as any;
    const windowActive = !!w && new Date(w.startsAt) <= now && now <= new Date(w.endsAt);
    const windowUpcoming = !!w && new Date(w.startsAt) > now;
    return {
      maintenanceMode: settings.maintenanceMode === true || windowActive,
      signupOpen: settings.signupOpen !== false,
      supportContact: settings.supportContact ?? "",
      announcement: current ? { title: current.title, body: current.body } : null,
      maintenanceWindow: w ? {
        startsAt: w.startsAt, endsAt: w.endsAt, message: w.message ?? "",
        hardLockout: w.hardLockout === true, active: windowActive, upcoming: windowUpcoming,
      } : null,
    };
  }

  async listAnnouncements() {
    return (this.prisma as any).announcement.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }
  async createAnnouncement(actor: any, dto: { title: string; body: string; startsAt?: string; endsAt?: string; audience?: string }, ip?: string) {
    if (!dto.title?.trim() || !dto.body?.trim()) throw new BadRequestException("Announcement title and body are required");
    if (dto.startsAt && Number.isNaN(Date.parse(dto.startsAt))) throw new BadRequestException("startsAt must be a valid ISO date");
    if (dto.endsAt && Number.isNaN(Date.parse(dto.endsAt))) throw new BadRequestException("endsAt must be a valid ISO date");
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt).getTime() <= new Date(dto.startsAt).getTime()) {
      throw new BadRequestException("endsAt must be after startsAt");
    }
    const audience = dto.audience ?? "all";
    if (!AdminService.ANNOUNCEMENT_AUDIENCES.includes(audience)) {
      throw new BadRequestException(`audience must be one of ${AdminService.ANNOUNCEMENT_AUDIENCES.join(", ")}`);
    }
    const row = await (this.prisma as any).announcement.create({
      data: { title: dto.title.trim(), body: dto.body.trim(), audience, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, active: true, createdById: actor.id },
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

  // AA7: the canonical flag list lives in common/feature-flags
  // (KNOWN_FLAG_KEYS) so the runtime resolver and this console can
  // never drift apart; copied so callers can't mutate the source.
  static readonly KNOWN_FLAGS = [...KNOWN_FLAG_KEYS];

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

  async updateOrgLimits(actor: any, organizationId: string, patch: { aiDailyLimitOverride?: number | null; broadcastCapOverride?: number | null; seatLimit?: number | null; whiteLabel?: boolean }, ip?: string) {
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
    // AB8 (AX24): white-label toggle rides this same org-update
    // path (the only admin org PATCH) — boolean-only, audited
    // through logAdmin in the before/after below like the limits.
    if (patch.whiteLabel !== undefined) {
      if (typeof patch.whiteLabel !== "boolean") throw new BadRequestException("whiteLabel must be a boolean");
      data.whiteLabel = patch.whiteLabel;
    }
    const before = { aiDailyLimitOverride: org.aiDailyLimitOverride ?? null, broadcastCapOverride: org.broadcastCapOverride ?? null, seatLimit: org.seatLimit ?? null, whiteLabel: org.whiteLabel === true };
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
      else broken.push({ id: r.id, provider: r.provider, status: r.status, organizationId: r.organizationId, organizationName: nameOf(r.organizationId), lastError: r.lastError ?? null, lastSyncAt: r.lastSyncAt ?? null, updatedAt: r.updatedAt ?? null });
    }
    return { byProvider, broken: broken.slice(0, 100) };
  }

  // ---------------- Admin Advanced AA5: Social + Ads operator boards ----------------
  // Cross-tenant, read-only, metadata-only. SocialAccount rows
  // NEVER hold credential material by SP1 design, and the ads
  // board reads integrations through a field-select that never
  // touches the credential relation — so neither payload can
  // carry a secret. Errors are surfaced VERBATIM: the operator
  // needs the platform's own words to act on them.

  async socialBoard() {
    const p = this.prisma as any;
    const now = Date.now();
    const staleCreatorBefore = new Date(now - 48 * 3600 * 1000);
    const stuckPublishingBefore = new Date(now - 15 * 60 * 1000);
    const accounts = await p.socialAccount.findMany({ take: 5000 }).catch(() => []);
    const accountRows: any[] = Array.isArray(accounts) ? accounts : [];
    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    for (const a of accountRows) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + 1;
    }
    const errorRows = accountRows
      .filter((a) => a.status === "error")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 100);

    const failedRowsRaw = await p.socialPost.findMany({
      where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 100,
    }).catch(() => []);
    const staleRowsRaw = await p.socialPost.findMany({
      where: { status: "sent_to_creator", updatedAt: { lt: staleCreatorBefore } },
      orderBy: { updatedAt: "desc" }, take: 100,
    }).catch(() => []);
    const stuckRowsRaw = await p.socialPost.findMany({
      where: { status: "publishing", updatedAt: { lt: stuckPublishingBefore } },
      orderBy: { updatedAt: "desc" }, take: 100,
    }).catch(() => []);
    // Counts are the FULL matching totals (items are capped at
    // 100) — a capped list must never masquerade as the total.
    const staleCountRaw = await p.socialPost.count({
      where: { status: "sent_to_creator", updatedAt: { lt: staleCreatorBefore } },
    }).catch(() => null);
    const stuckCountRaw = await p.socialPost.count({
      where: { status: "publishing", updatedAt: { lt: stuckPublishingBefore } },
    }).catch(() => null);
    // Re-filter in memory as a second guard: the stale/stuck
    // definitions live here, not only in the query.
    const failedRows: any[] = (Array.isArray(failedRowsRaw) ? failedRowsRaw : []).slice(0, 100);
    const staleRows: any[] = (Array.isArray(staleRowsRaw) ? staleRowsRaw : [])
      .filter((r: any) => new Date(r.updatedAt).getTime() < staleCreatorBefore.getTime()).slice(0, 100);
    const stuckRows: any[] = (Array.isArray(stuckRowsRaw) ? stuckRowsRaw : [])
      .filter((r: any) => new Date(r.updatedAt).getTime() < stuckPublishingBefore.getTime()).slice(0, 100);
    const staleCount = typeof staleCountRaw === "number" ? staleCountRaw : staleRows.length;
    const stuckCount = typeof stuckCountRaw === "number" ? stuckCountRaw : stuckRows.length;

    // Resolve account name/platform for posts whose account is
    // not among the fetched rows (defensive — the 5000-cap fetch
    // normally covers every account a post can reference).
    const accountById = new Map<string, any>(accountRows.map((a) => [a.id, a]));
    const postRows = [...failedRows, ...staleRows, ...stuckRows];
    const missingAccountIds = [...new Set(postRows.map((r) => r.socialAccountId).filter((id) => id && !accountById.has(id)))];
    if (missingAccountIds.length > 0) {
      const extra = await p.socialAccount.findMany({ where: { id: { in: missingAccountIds } } }).catch(() => []);
      for (const a of (Array.isArray(extra) ? extra : []) as any[]) accountById.set(a.id, a);
    }
    // One organization lookup for every org the payload names.
    const orgIds = [...new Set([
      ...errorRows.map((a) => a.organizationId),
      ...postRows.map((r) => r.organizationId),
    ].filter(Boolean))];
    const orgs = orgIds.length > 0
      ? await p.organization.findMany({ where: { id: { in: orgIds } } }).catch(() => [])
      : [];
    const nameOf = (id: string) => (orgs as any[]).find((o) => o.id === id)?.name ?? null;

    const postItem = (r: any) => {
      const account = accountById.get(r.socialAccountId);
      return {
        id: r.id, organizationId: r.organizationId, organizationName: nameOf(r.organizationId),
        socialAccountId: r.socialAccountId,
        accountName: account?.name ?? null, platform: account?.platform ?? null,
        status: r.status, error: r.error ?? null,
        captionExcerpt: String(r.caption ?? "").slice(0, 80),
        scheduledAt: r.scheduledAt ?? null, updatedAt: r.updatedAt ?? null,
      };
    };
    return {
      accounts: { total: accountRows.length, byStatus, byPlatform },
      errorAccounts: errorRows.map((a) => ({
        id: a.id, organizationId: a.organizationId, organizationName: nameOf(a.organizationId),
        platform: a.platform, name: a.name, username: a.username ?? null,
        lastError: a.lastError ?? null, updatedAt: a.updatedAt ?? null,
      })),
      posts: {
        failed: failedRows.map(postItem),
        sentToCreatorStale: { count: staleCount, items: staleRows.map(postItem) },
        stuckPublishing: { count: stuckCount, items: stuckRows.map(postItem) },
      },
    };
  }

  async adsBoard() {
    const p = this.prisma as any;
    const accounts = await p.adAccount.findMany({ take: 5000 }).catch(() => []);
    const accountRows: any[] = Array.isArray(accounts) ? accounts : [];
    const integrationIds = [...new Set(accountRows.map((a) => a.integrationId).filter(Boolean))] as string[];
    let integrations: any[] = [];
    if (integrationIds.length > 0) {
      // Select ONLY the health fields — never include the
      // credential relation, so no credential material can leak.
      try {
        integrations = await p.integration.findMany({
          where: { id: { in: integrationIds } },
          select: { id: true, status: true, lastSyncAt: true, lastError: true, createdAt: true },
        });
      } catch {
        try {
          integrations = await p.integration.findMany({ where: { id: { in: integrationIds } } });
        } catch { integrations = []; }
      }
      if (!Array.isArray(integrations)) integrations = [];
    }
    const integrationById = new Map<string, any>((integrations as any[]).map((i) => [i.id, i]));
    const now = Date.now();
    const byHealth: Record<string, number> = {};
    const platformBuckets: Record<string, number> = {};
    let syncDisabledCount = 0;
    const bandById = new Map<string, string>();
    for (const a of accountRows) {
      const band = computeAdAccountHealth(a, a.integrationId ? (integrationById.get(a.integrationId) ?? null) : null, now);
      bandById.set(a.id, band);
      byHealth[band] = (byHealth[band] ?? 0) + 1;
      const bucket = a.platformStatusBucket ? String(a.platformStatusBucket) : "none";
      platformBuckets[bucket] = (platformBuckets[bucket] ?? 0) + 1;
      if (a.syncDisabled) syncDisabledCount++;
    }
    const brokenRows = accountRows
      .filter((a) => bandById.get(a.id) === "error" || a.platformStatusBucket === "disabled" || a.platformStatusBucket === "restricted")
      .sort((a, b) => {
        const ea = bandById.get(a.id) === "error" ? 0 : 1;
        const eb = bandById.get(b.id) === "error" ? 0 : 1;
        if (ea !== eb) return ea - eb;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 100);
    const orgIds = [...new Set(brokenRows.map((a) => a.organizationId).filter(Boolean))];
    const orgs = orgIds.length > 0
      ? await p.organization.findMany({ where: { id: { in: orgIds } } }).catch(() => [])
      : [];
    const nameOf = (id: string) => (orgs as any[]).find((o) => o.id === id)?.name ?? null;
    return {
      total: accountRows.length,
      byHealth,
      platformBuckets,
      syncDisabledCount,
      broken: brokenRows.map((a) => {
        const integration = a.integrationId ? integrationById.get(a.integrationId) : undefined;
        return {
          id: a.id, organizationId: a.organizationId, organizationName: nameOf(a.organizationId),
          name: a.name, label: a.label ?? null, displayName: a.label ?? a.name,
          platform: a.platform, health: bandById.get(a.id),
          platformStatusBucket: a.platformStatusBucket ?? null,
          lastError: integration?.lastError ?? null,
          lastSyncAt: integration?.lastSyncAt ?? null,
          updatedAt: a.updatedAt ?? null,
        };
      }),
    };
  }

  // ---------------- Admin Next AB3 / AN13: Social/Ads operator retry ----
  // Every action below delegates to the SAME service method the
  // tenant side already uses — no parallel admin logic, no
  // invented provider calls:
  //  - failed social post   -> SocialHealthService.retryPost
  //    (the tenant's POST posts/:id/retry path; its status gate
  //    and publish path apply unchanged, errors verbatim)
  //  - stuck publishing post -> SocialPublishService.runDuePublishes
  //    (the org sweep the social_publish_due job runs every
  //    5 min; its stale-claim recovery is the ONLY recovery
  //    path that exists — it recovers every stale claim of the
  //    org and publishes its due posts, not just this one)
  //  - error social account -> SocialHealthService.checkAccountHealth
  //    (the tenant's health re-check; real provider probe)
  //  - broken ad account    -> AdsService.sync{Meta,Google,TikTok}Insights
  //    (the tenant card's per-account Sync button, {} window;
  //    its deny gate sees a non-member actor and does not deny,
  //    its syncDisabled refusal propagates verbatim)
  // Board categories with NO real retry path stay view-only:
  // sent_to_creator stale posts wait on a human creator — there
  // is nothing to retry. Disconnect/reconnect is NOT offered:
  // it needs the tenant's own OAuth.
  // Delegation failures are audited as attempts and then
  // rethrown verbatim — never converted into a success.

  private requireOpsService(svc: unknown, label: string) {
    if (!svc) {
      throw new BadRequestException(`${label} এই deployment-এ উপলব্ধ নয় (service wired নয়) — কোনো retry করা হয়নি।`);
    }
  }

  async socialOpsRetryPost(actor: any, postId: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    this.requireOpsService(this.socialHealth, "Social retry service");
    const p = this.prisma as any;
    const post = await p.socialPost.findUnique({ where: { id: postId } }).catch(() => null);
    if (!post) throw new NotFoundException("Social post not found");
    const before = { status: post.status };
    try {
      const result = await this.socialHealth!.retryPost(post.organizationId, actor.id, postId);
      const fresh = await p.socialPost.findUnique({ where: { id: postId } }).catch(() => null);
      await this.logAdmin(actor, "social_ops_retry_post", "SocialPost", postId, {
        organizationId: post.organizationId, reason: why, outcome: "delegated",
        before, after: { status: fresh?.status ?? null },
      }, ip);
      return { retried: true, kind: "failed_post", organizationId: post.organizationId, result };
    } catch (e) {
      await this.logAdmin(actor, "social_ops_retry_post", "SocialPost", postId, {
        organizationId: post.organizationId, reason: why, outcome: "failed", before,
        error: AdminService.errText(e),
      }, ip).catch(() => undefined);
      throw e;
    }
  }

  async socialOpsRecoverStuck(actor: any, postId: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    this.requireOpsService(this.socialPublish, "Social publish service");
    const p = this.prisma as any;
    const post = await p.socialPost.findUnique({ where: { id: postId } }).catch(() => null);
    if (!post) throw new NotFoundException("Social post not found");
    if (post.status !== "publishing") {
      throw new BadRequestException(`এই পোস্টটি Publishing অবস্থায় নেই (এখন: "${post.status}") — stuck recovery শুধু Publishing-এ আটকে থাকা পোস্টের জন্য।`);
    }
    const before = { status: post.status };
    try {
      const sweep = await this.socialPublish!.runDuePublishes(post.organizationId);
      const fresh = await p.socialPost.findUnique({ where: { id: postId } }).catch(() => null);
      await this.logAdmin(actor, "social_ops_recover_stuck", "SocialPost", postId, {
        organizationId: post.organizationId, reason: why, outcome: "delegated",
        before, after: { status: fresh?.status ?? null }, sweep,
      }, ip);
      return {
        retried: true, kind: "stuck_publishing", organizationId: post.organizationId,
        note: "এটি ওই Org-এর publish sweep চালিয়েছে — stale claim recovery-সহ Org-এর সব due post প্রসেস হয়েছে, শুধু এই পোস্টটি নয়।",
        sweep, postStatusAfter: fresh?.status ?? null,
      };
    } catch (e) {
      await this.logAdmin(actor, "social_ops_recover_stuck", "SocialPost", postId, {
        organizationId: post.organizationId, reason: why, outcome: "failed", before,
        error: AdminService.errText(e),
      }, ip).catch(() => undefined);
      throw e;
    }
  }

  async socialOpsRecheckAccount(actor: any, accountId: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    this.requireOpsService(this.socialHealth, "Social health service");
    const p = this.prisma as any;
    const account = await p.socialAccount.findUnique({ where: { id: accountId } }).catch(() => null);
    if (!account) throw new NotFoundException("Social account not found");
    const before = { status: account.status };
    try {
      const result = await this.socialHealth!.checkAccountHealth(account.organizationId, actor.id, accountId);
      await this.logAdmin(actor, "social_ops_recheck_account", "SocialAccount", accountId, {
        organizationId: account.organizationId, reason: why, outcome: "delegated",
        before, after: { status: (result as any)?.status ?? null, ok: (result as any)?.ok ?? null },
      }, ip);
      return { retried: true, kind: "account_recheck", organizationId: account.organizationId, result };
    } catch (e) {
      await this.logAdmin(actor, "social_ops_recheck_account", "SocialAccount", accountId, {
        organizationId: account.organizationId, reason: why, outcome: "failed", before,
        error: AdminService.errText(e),
      }, ip).catch(() => undefined);
      throw e;
    }
  }

  async socialOpsRetryAdSync(actor: any, accountId: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    this.requireOpsService(this.ads, "Ads sync service");
    const p = this.prisma as any;
    const account = await p.adAccount.findUnique({ where: { id: accountId } }).catch(() => null);
    if (!account) throw new NotFoundException("Ad account not found");
    const platform = String(account.platform ?? "");
    if (!["meta", "google", "tiktok"].includes(platform)) {
      throw new BadRequestException(`এই Platform-এর (${platform || "অজানা"}) কোনো insights sync পথ নেই — Sync retry করা যাবে না।`);
    }
    const before = { platform, updatedAt: account.updatedAt ?? null };
    try {
      const result = platform === "meta"
        ? await this.ads!.syncMetaInsights(account.organizationId, actor.id, accountId, {})
        : platform === "google"
          ? await this.ads!.syncGoogleInsights(account.organizationId, actor.id, accountId, {})
          : await this.ads!.syncTikTokInsights(account.organizationId, actor.id, accountId, {});
      await this.logAdmin(actor, "social_ops_retry_ad_sync", "AdAccount", accountId, {
        organizationId: account.organizationId, reason: why, outcome: "delegated", platform, before,
      }, ip);
      return { retried: true, kind: "ad_sync", organizationId: account.organizationId, platform, result };
    } catch (e) {
      await this.logAdmin(actor, "social_ops_retry_ad_sync", "AdAccount", accountId, {
        organizationId: account.organizationId, reason: why, outcome: "failed", platform, before,
        error: AdminService.errText(e),
      }, ip).catch(() => undefined);
      throw e;
    }
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

  // ---------------- Admin Next AN15: Platform Connection-Health Board ----------------
  // Cross-org operator board built ONLY from real
  // ConnectionHealthCheck rows (the CC11 Doctor's recorded runs)
  // plus the connection target rows they reference (Integration /
  // SocialAccount / AdAccount — the same universe the Doctor
  // records against via the Connect Center overview).
  //
  // Health math is CC22's (ConnectionAnalyticsService), NOT a
  // second definition: a run's outcome is its stored `overall`
  // ("pass" = ok, "fail" = failed, "partial" = degraded);
  // degraded counts in the denominator, never the numerator;
  // uptimePct = pass / total runs over the 30-day window, one
  // decimal; ZERO checks => uptimePct null (no data is neither
  // 0% nor 100%). The ONLY addition beyond CC22 is the board
  // status used for worst-first ordering: broken = latest run
  // failed; at_risk = latest run partial OR the target row's own
  // tokenExpiresAt is inside CC12's 7-day expiry buckets (the
  // monitor's dayBucket thresholds, <=7/<=3/<=1 days, expired
  // included); ok = latest run passed with no expiry risk;
  // no_data = never checked. Target rows are read through
  // field-selects that never touch credential material (the
  // Integration credential relation / any secret column is
  // never selected, and check-row `steps` are never copied
  // into the payload).
  async healthConnections(now = new Date()) {
    const p = this.prisma as any;
    const DAY = 86400000;
    const since30 = new Date(now.getTime() - 30 * DAY);
    const [integrations, socials, ads, checks] = await Promise.all([
      p.integration.findMany({ take: 1000, select: { id: true, organizationId: true, provider: true, status: true, tokenExpiresAt: true } }).catch(() => []),
      p.socialAccount.findMany({ take: 1000, select: { id: true, organizationId: true, platform: true, name: true, status: true } }).catch(() => []),
      p.adAccount.findMany({ take: 1000, select: { id: true, organizationId: true, platform: true, name: true, status: true } }).catch(() => []),
      p.connectionHealthCheck.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }).catch(() => []),
    ]);

    // Universe from the target rows (CC11 identity:
    // targetType = overview source, targetId = row id).
    const targets = new Map<string, any>();
    const addTarget = (t: any) => targets.set(`${t.organizationId}:${t.targetType}:${t.targetId}`, t);
    for (const r of integrations as any[]) addTarget({ organizationId: r.organizationId, targetType: "integration", targetId: r.id, provider: r.provider ?? null, category: null, displayName: null, targetStatus: r.status ?? null, tokenExpiresAt: r.tokenExpiresAt ?? null });
    for (const r of socials as any[]) addTarget({ organizationId: r.organizationId, targetType: "social_account", targetId: r.id, provider: r.platform ?? null, category: "social", displayName: r.name ?? null, targetStatus: r.status ?? null, tokenExpiresAt: null });
    for (const r of ads as any[]) addTarget({ organizationId: r.organizationId, targetType: "ad_account", targetId: r.id, provider: r.platform ?? null, category: "ads", displayName: r.name ?? null, targetStatus: r.status ?? null, tokenExpiresAt: null });

    // Recorded runs per target, newest first. A target that has
    // check rows but whose backing row is gone (deleted
    // connection) still appears — its identity comes from the
    // check rows' own snapshots, marked targetStatus "missing".
    const runsByTarget = new Map<string, any[]>();
    for (const row of checks as any[]) {
      const key = `${row.organizationId}:${row.targetType}:${row.targetId}`;
      const list = runsByTarget.get(key) ?? [];
      list.push(row);
      runsByTarget.set(key, list);
      if (!targets.has(key)) {
        addTarget({ organizationId: row.organizationId, targetType: row.targetType, targetId: row.targetId, provider: row.provider ?? null, category: row.category ?? null, displayName: row.displayName ?? null, targetStatus: "missing", tokenExpiresAt: null });
      }
    }

    const orgIds = [...new Set([...targets.values()].map((t) => t.organizationId))];
    const orgs = orgIds.length ? await p.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).catch(() => []) : [];
    const nameOf = (id: string) => (orgs as any[]).find((o) => o.id === id)?.name ?? id;

    const connections: any[] = [];
    for (const t of targets.values()) {
      const runs = runsByTarget.get(`${t.organizationId}:${t.targetType}:${t.targetId}`) ?? [];
      const windowRuns = runs.filter((r) => new Date(r.createdAt).getTime() >= since30.getTime());
      let passed = 0, failed = 0, degraded = 0, lastFailureAt: string | null = null;
      for (const run of windowRuns) {
        const overall = String(run.overall ?? "");
        if (overall === "pass") passed++;
        else if (overall === "fail") { failed++; if (!lastFailureAt) lastFailureAt = new Date(run.createdAt).toISOString(); }
        else if (overall === "partial") degraded++;
      }
      const checksCount = windowRuns.length;
      const latest = runs[0] ?? null;
      const latestStatus = latest ? String(latest.overall ?? "") : null;
      // CC12 expiry buckets (monitor dayBucket thresholds).
      let tokenDaysLeft: number | null = null;
      let expiryBucket: string | null = null;
      if (t.tokenExpiresAt) {
        tokenDaysLeft = Math.floor((new Date(t.tokenExpiresAt).getTime() - now.getTime()) / DAY);
        if (tokenDaysLeft <= 1) expiryBucket = "expiring_1";
        else if (tokenDaysLeft <= 3) expiryBucket = "expiring_3";
        else if (tokenDaysLeft <= 7) expiryBucket = "expiring_7";
      }
      let boardStatus: string;
      if (!latest) boardStatus = "no_data";
      else if (latestStatus === "fail") boardStatus = "broken";
      else if (latestStatus === "partial" || expiryBucket) boardStatus = "at_risk";
      else boardStatus = "ok";
      connections.push({
        organizationId: t.organizationId,
        organizationName: nameOf(t.organizationId),
        targetType: t.targetType, targetId: t.targetId,
        provider: t.provider, category: t.category, displayName: t.displayName,
        targetStatus: t.targetStatus,
        checks: checksCount, passed, failed, degraded,
        uptimePct: checksCount > 0 ? Math.round((passed / checksCount) * 1000) / 10 : null,
        latestStatus,
        lastCheckedAt: latest ? new Date(latest.createdAt).toISOString() : null,
        lastFailureAt,
        tokenExpiresAt: t.tokenExpiresAt ? new Date(t.tokenExpiresAt).toISOString() : null,
        tokenDaysLeft, expiryBucket,
        boardStatus,
      });
    }

    const rank: Record<string, number> = { broken: 0, at_risk: 1, ok: 2, no_data: 3 };
    connections.sort((a, b) =>
      (rank[a.boardStatus] - rank[b.boardStatus])
      || (b.failed - a.failed)
      || (String(b.lastCheckedAt ?? "").localeCompare(String(a.lastCheckedAt ?? "")))
      || String(a.organizationName).localeCompare(String(b.organizationName)));

    const summary = { total: connections.length, broken: 0, atRisk: 0, ok: 0, noData: 0 };
    for (const c of connections) {
      if (c.boardStatus === "broken") summary.broken++;
      else if (c.boardStatus === "at_risk") summary.atRisk++;
      else if (c.boardStatus === "ok") summary.ok++;
      else summary.noData++;
    }
    return { generatedAt: now.toISOString(), windowDays: 30, summary, connections };
  }

  async usageBoard() {
    const since30 = new Date(Date.now() - 30 * 86400000);
    const orgs = await (this.prisma as any).organization.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    // AA6 (C6): per-org MediaAsset storage. Prefer a single
    // DB-side groupBy; older spec fakes (and any delegate that
    // lacks groupBy) fall back to per-org findMany summed in JS.
    // Channel/inbox media has NO byte-size data anywhere, so it
    // is deliberately NOT estimated here — only MediaAsset
    // storage is reported.
    let storageByOrg: Map<string, { bytes: number; count: number }> | null = null;
    try {
      const grouped = await (this.prisma as any).mediaAsset.groupBy({
        by: ["organizationId"], _sum: { sizeBytes: true }, _count: { _all: true },
      });
      if (Array.isArray(grouped)) {
        storageByOrg = new Map();
        for (const g of grouped as any[]) {
          const count = typeof g._count === "number" ? g._count : (g._count?._all ?? 0);
          storageByOrg.set(g.organizationId, { bytes: Number(g._sum?.sizeBytes ?? 0), count: Number(count ?? 0) });
        }
      }
    } catch { storageByOrg = null; }
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
      let storageBytes = 0;
      let mediaAssets = 0;
      if (storageByOrg) {
        const s = storageByOrg.get(org.id);
        storageBytes = s?.bytes ?? 0;
        mediaAssets = s?.count ?? 0;
      } else {
        try {
          const assets = await (this.prisma as any).mediaAsset.findMany({
            where: { organizationId: org.id }, select: { sizeBytes: true },
          }).catch(() => []);
          const assetRows: any[] = Array.isArray(assets) ? assets : [];
          mediaAssets = assetRows.length;
          storageBytes = assetRows.reduce((a: number, r: any) => a + Number(r.sizeBytes ?? 0), 0);
        } catch { storageBytes = 0; mediaAssets = 0; }
      }
      out.push({
        organizationId: org.id, name: org.name, status: org.status,
        aiCalls30d: (aiRows as any[]).length, aiTokens30d: aiTokens,
        deliveries30d: deliveries, broadcastsTotal: broadcasts, workflowRuns30d: workflowRuns,
        courierShipmentsTotal: shipments, orders30d: orders,
        storageBytes, mediaAssets,
      });
    }
    return out;
  }

  /** RB6/RM12: platform storage overview, aggregated from the
   * RM3 StoredFile registry — the same single source the tenant
   * media library reads. Totals exclude trashed rows (reported
   * separately: their bytes still occupy the bucket until the
   * RM11 sweep purges them). All byte sums are decimal strings
   * (BigInt-safe). Measurement only — quota values are the
   * owner's to set (plan RM3), nothing here enforces or invents
   * a limit. Aggregation prefers DB-side groupBy (AA6 pattern);
   * delegates without it fall back to a capped findMany summed
   * in JS, flagged with `truncated` when the cap is hit. */
  async storageOverview() {
    const mode = publicMediaServingEnabled() ? "s3" : "local";
    const table = (this.prisma as any).storedFile;
    const base = {
      mode,
      registryAvailable: Boolean(table),
      totalObjects: 0,
      totalBytes: "0",
      trashedObjects: 0,
      trashedBytes: "0",
      byBucket: [] as any[],
      byVisibility: [] as any[],
      bySurface: [] as any[],
      topOrgs: [] as any[],
      truncated: false,
    };
    if (!table) return base;
    const countOf = (g: any) => (typeof g?._count === "number" ? g._count : (g?._count?._all ?? 0));
    const sumOf = (g: any) => BigInt(g?._sum?.sizeBytes ?? 0);
    try {
      if (typeof table.groupBy === "function") {
        const live = { status: { not: "trashed" } };
        const [byBucket, byVisibility, bySurface, byOrg, totalAgg, trashedAgg] = await Promise.all([
          table.groupBy({ by: ["bucket"], where: live, _sum: { sizeBytes: true }, _count: { _all: true } }),
          table.groupBy({ by: ["visibility"], where: live, _sum: { sizeBytes: true }, _count: { _all: true } }),
          table.groupBy({ by: ["surface"], where: live, _sum: { sizeBytes: true }, _count: { _all: true } }),
          table.groupBy({
            by: ["organizationId"], where: live, _sum: { sizeBytes: true }, _count: { _all: true },
            orderBy: { _sum: { sizeBytes: "desc" } }, take: 10,
          }),
          table.aggregate({ where: live, _sum: { sizeBytes: true }, _count: { _all: true } }),
          table.aggregate({ where: { status: "trashed" }, _sum: { sizeBytes: true }, _count: { _all: true } }),
        ]);
        const shape = (rows: any[], key: string) =>
          (rows ?? []).map((g: any) => ({ [key]: g[key], objects: countOf(g), bytes: sumOf(g).toString() }));
        base.byBucket = shape(byBucket, "bucket");
        base.byVisibility = shape(byVisibility, "visibility");
        base.bySurface = shape(bySurface, "surface").sort((a: any, b: any) => Number(BigInt(b.bytes) - BigInt(a.bytes)));
        base.totalObjects = countOf(totalAgg);
        base.totalBytes = sumOf(totalAgg).toString();
        base.trashedObjects = countOf(trashedAgg);
        base.trashedBytes = sumOf(trashedAgg).toString();
        base.topOrgs = await this.storageTopOrgs(byOrg ?? [], countOf, sumOf);
        return base;
      }
      throw new Error("groupBy unavailable");
    } catch {
      // Fallback: capped findMany summed in JS (AA6 discipline).
      try {
        const CAP = 20000;
        const rows: any[] = (await table.findMany({ take: CAP })) ?? [];
        base.truncated = rows.length >= CAP;
        const liveRows = rows.filter((r: any) => r.status !== "trashed");
        const agg = (key: string) => {
          const map = new Map<string, { objects: number; bytes: bigint }>();
          for (const r of liveRows) {
            const k = String(r[key] ?? "");
            const e = map.get(k) ?? { objects: 0, bytes: 0n };
            e.objects += 1;
            e.bytes += BigInt(r.sizeBytes ?? 0);
            map.set(k, e);
          }
          return [...map.entries()].map(([v, e]) => ({ [key]: v, objects: e.objects, bytes: e.bytes.toString() }));
        };
        base.byBucket = agg("bucket");
        base.byVisibility = agg("visibility");
        base.bySurface = agg("surface").sort((a: any, b: any) => Number(BigInt(b.bytes) - BigInt(a.bytes)));
        base.totalObjects = liveRows.length;
        base.totalBytes = liveRows.reduce((a: bigint, r: any) => a + BigInt(r.sizeBytes ?? 0), 0n).toString();
        const trashed = rows.filter((r: any) => r.status === "trashed");
        base.trashedObjects = trashed.length;
        base.trashedBytes = trashed.reduce((a: bigint, r: any) => a + BigInt(r.sizeBytes ?? 0), 0n).toString();
        const orgAgg = new Map<string, { objects: number; bytes: bigint }>();
        for (const r of liveRows) {
          const e = orgAgg.get(r.organizationId) ?? { objects: 0, bytes: 0n };
          e.objects += 1;
          e.bytes += BigInt(r.sizeBytes ?? 0);
          orgAgg.set(r.organizationId, e);
        }
        const byOrg = [...orgAgg.entries()]
          .map(([organizationId, e]) => ({ organizationId, _count: { _all: e.objects }, _sum: { sizeBytes: e.bytes } }))
          .sort((a, b) => Number(b._sum.sizeBytes - a._sum.sizeBytes))
          .slice(0, 10);
        base.topOrgs = await this.storageTopOrgs(byOrg, countOf, sumOf);
        return base;
      } catch {
        return { ...base, registryAvailable: false };
      }
    }
  }

  /** RM12 helper: attach org names to groupBy org rows. */
  private async storageTopOrgs(byOrg: any[], countOf: (g: any) => number, sumOf: (g: any) => bigint) {
    const ids = byOrg.map((g: any) => g.organizationId).filter(Boolean);
    const names = new Map<string, string>();
    if (ids.length) {
      try {
        const orgs: any[] = (await (this.prisma as any).organization.findMany({ where: { id: { in: ids } } })) ?? [];
        for (const o of orgs) names.set(String(o.id), String(o.name ?? ""));
      } catch { /* names are decoration; numbers still ship */ }
    }
    return byOrg.map((g: any) => ({
      organizationId: g.organizationId,
      name: names.get(String(g.organizationId)) ?? null,
      objects: countOf(g),
      bytes: sumOf(g).toString(),
    }));
  }

  /** AA7 (C12): AI usage drill-down — per organization × feature
   * rows from AIUsageRecord for a window (days, default 30, capped
   * at 90). Tokens and call counts ONLY: money stays on the
   * Analytics AI-cost board, where the operator sets the rates —
   * no second, possibly divergent, price source is invented here.
   * `estimatedCalls` counts records whose token numbers are dev-
   * adapter estimates (AIUsageRecord.estimated), shown separately
   * so real and estimated usage are never silently blended.
   * Aggregation prefers DB-side groupBy (AA6 pattern); delegates
   * without groupBy fall back to a capped findMany summed in JS. */
  async aiUsageDetail(daysRaw?: number, organizationId?: string) {
    const days = Math.min(90, Math.max(1, Math.floor(Number(daysRaw) || 30)));
    const since = new Date(Date.now() - days * 86400000);
    const where: Record<string, unknown> = { createdAt: { gte: since } };
    if (organizationId) where.organizationId = organizationId;
    type Agg = { organizationId: string; feature: string; calls: number; inputTokens: number; outputTokens: number; estimatedCalls: number };
    const map = new Map<string, Agg>();
    const slot = (org: string, feature: string): Agg => {
      const k = org + "|" + feature;
      let a = map.get(k);
      if (!a) { a = { organizationId: org, feature, calls: 0, inputTokens: 0, outputTokens: 0, estimatedCalls: 0 }; map.set(k, a); }
      return a;
    };
    const countOf = (g: any) => (typeof g?._count === "number" ? g._count : Number(g?._count?._all ?? 0));
    let grouped: any[] | null = null;
    try {
      grouped = await (this.prisma as any).aIUsageRecord.groupBy({
        by: ["organizationId", "feature"], where,
        _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true },
      });
    } catch { grouped = null; }
    if (Array.isArray(grouped)) {
      for (const g of grouped as any[]) {
        const a = slot(String(g.organizationId), String(g.feature));
        a.calls += countOf(g);
        a.inputTokens += Number(g._sum?.inputTokens ?? 0);
        a.outputTokens += Number(g._sum?.outputTokens ?? 0);
      }
      // Estimated-call split: a second grouped pass over the
      // estimated subset only. If it fails, estimates stay 0 —
      // visible as "unknown split", never blended into real calls.
      try {
        const est = await (this.prisma as any).aIUsageRecord.groupBy({
          by: ["organizationId", "feature"], where: { ...where, estimated: true }, _count: { _all: true },
        });
        if (Array.isArray(est)) {
          for (const g of est as any[]) slot(String(g.organizationId), String(g.feature)).estimatedCalls += countOf(g);
        }
      } catch { /* split unavailable */ }
    } else {
      const rows = await (this.prisma as any).aIUsageRecord.findMany({ where, take: 20000 }).catch(() => []);
      for (const r of rows as any[]) {
        const a = slot(String(r.organizationId), String(r.feature));
        a.calls += 1;
        a.inputTokens += Number(r.inputTokens ?? 0);
        a.outputTokens += Number(r.outputTokens ?? 0);
        if (r.estimated === true) a.estimatedCalls += 1;
      }
    }
    const orgIds = [...new Set([...map.values()].map((a) => a.organizationId))];
    const orgs = orgIds.length
      ? await (this.prisma as any).organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).catch(() => [])
      : [];
    const nameOf = (id: string) => (orgs as any[]).find((o) => o.id === id)?.name ?? id;
    const all = [...map.values()].map((a) => ({ ...a, orgName: nameOf(a.organizationId), totalTokens: a.inputTokens + a.outputTokens }));
    all.sort((x, y) => (y.totalTokens - x.totalTokens) || (y.calls - x.calls));
    return { days, since, totalRows: all.length, rows: all.slice(0, 200) };
  }

  /** AA7: CSV twin of aiUsageDetail (same window/filter, full
   * 200-row cap), mirroring the billing/audit export pattern. */
  async exportAiUsageCsv(daysRaw?: number, organizationId?: string): Promise<string> {
    const { days, rows } = await this.aiUsageDetail(daysRaw, organizationId);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [`# AI usage by feature — last ${days} days (tokens/calls only; costs live on the Analytics AI-cost board)`];
    lines.push("organizationId,orgName,feature,calls,inputTokens,outputTokens,totalTokens,estimatedCalls");
    for (const r of rows) {
      lines.push([r.organizationId, esc(r.orgName), esc(r.feature), r.calls, r.inputTokens, r.outputTokens, r.totalTokens, r.estimatedCalls].join(","));
    }
    return lines.join("\n");
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

  /** GC22 (GB9): admin pause/resume of an org's subscription —
   * the same pausedAt stamp the tenant endpoints write, with
   * the admin reason + audit pattern. */
  async pauseOrgSubscription(actor: any, organizationId: string, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const sub = await (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    if (!sub) throw new BadRequestException("Organization has no subscription to pause");
    if (sub.status === "CANCELLED") throw new BadRequestException("A CANCELLED subscription cannot be paused");
    if (sub.pausedAt) return { ...sub, alreadyPaused: true };
    const row = await (this.prisma as any).subscription.update({ where: { id: sub.id }, data: { pausedAt: new Date() } });
    await this.logAdmin(actor, "subscription_paused", "Organization", organizationId, { subscriptionId: sub.id, plan: sub.plan, status: sub.status, reason: why }, ip);
    return row;
  }

  async resumeOrgSubscription(actor: any, organizationId: string, reason: string, ip?: string) {
    const why = this.requireReason(reason);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const sub = await (this.prisma as any).subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    if (!sub) throw new BadRequestException("Organization has no subscription to resume");
    if (!sub.pausedAt) return { ...sub, alreadyResumed: true };
    const row = await (this.prisma as any).subscription.update({ where: { id: sub.id }, data: { pausedAt: null } });
    await this.logAdmin(actor, "subscription_resumed", "Organization", organizationId, { subscriptionId: sub.id, plan: sub.plan, status: sub.status, reason: why }, ip);
    return row;
  }

  async recordPayment(actor: any, dto: { organizationId: string; amountMinor: string | number; currency?: string; method: string; reference?: string; periodStart?: string; periodEnd?: string; note?: string }, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: dto.organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    if (!AdminService.PAYMENT_METHODS.includes(dto.method)) throw new BadRequestException(`method must be one of ${AdminService.PAYMENT_METHODS.join(", ")}`);
    let amount: bigint;
    try { amount = BigInt(dto.amountMinor); } catch { throw new BadRequestException("amountMinor must be an integer in minor units"); }
    if (amount <= 0n) throw new BadRequestException("Payment amount must be positive");
    const priorPayments = (await (this.prisma as any).saasPayment.count?.({ where: { organizationId: dto.organizationId } })?.catch?.(() => 1)) ?? 1;
    const row = await (this.prisma as any).saasPayment.create({
      data: {
        organizationId: dto.organizationId, amountMinor: amount, currency: dto.currency ?? "BDT", method: dto.method,
        reference: dto.reference ?? null, periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null, recordedById: actor.id, note: dto.note ?? null,
      },
    });
    await this.logAdmin(actor, "payment_recorded", "SaasPayment", row.id, { organizationId: dto.organizationId, amountMinor: amount.toString(), method: dto.method, reference: dto.reference ?? null }, ip);
    // Milestone 41: a manual payment is also a first payment for referrals.
    if (priorPayments === 0) {
      try { await maybeRewardReferral(this.prisma as any, this.audit, dto.organizationId, { amountMinor: amount }); }
      catch { /* rewards never block payment records */ }
    }
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
    // Referral Advanced R3: a FULL refund of the payment
    // that caused a referral reward reverses the reward.
    let referralClawback: { clawedBack: boolean; debitedMinor?: string; shortfallMinor?: string } = { clawedBack: false };
    if (already + amount >= gross) {
      try {
        const { maybeClawbackReferral } = await import("../common/referral");
        referralClawback = await maybeClawbackReferral(this.prisma as any, this.audit, { id, organizationId: row.organizationId });
      } catch { /* clawback never blocks a refund */ }
    }
    return {
      ...updated, amountMinor: gross.toString(),
      refundedMinor: (already + amount).toString(),
      netMinor: (gross - already - amount).toString(), accessRevoked, referralClawback,
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
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId: payment.organizationId } })?.catch?.(() => null) ?? null;
    return buildInvoiceHtml({ payment, orgName: org?.name ?? payment.organizationId, buyer: { address: profile?.billingAddress ?? null, bin: profile?.billingBin ?? null } });
  }

  /** GC22 (GB9): the same invoice as a PDF, from the shared
   * saasInvoiceData assembly (identical number/amounts). */
  async paymentInvoicePdf(id: string): Promise<Buffer> {
    const { payment, org } = await this.paymentWithOrg(id);
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId: payment.organizationId } })?.catch?.(() => null) ?? null;
    return buildSaasInvoicePdf(saasInvoiceData(payment, org?.name ?? payment.organizationId, { address: profile?.billingAddress ?? null, bin: profile?.billingBin ?? null }));
  }

  async sendInvoiceEmail(actor: any, id: string, ip?: string) {
    const { payment, org } = await this.paymentWithOrg(id);
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId: payment.organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    }).catch(() => []);
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId: payment.organizationId } })?.catch?.(() => null) ?? null;
    const extra: string[] = Array.isArray(profile?.billingEmails) ? profile.billingEmails : [];
    const recipients = [...new Set([...(memberships as any[]).map((m) => m.user?.email).filter(Boolean), ...extra])] as string[];
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
    const dunningJobs = await (this.prisma as any).scheduledJob.findMany({
      where: { type: "dunning_reminders" },
    }).catch(() => []);
    const reminderConfigured = new Set(
      ((dunningJobs as any[]) ?? []).filter((j: any) => j.enabled).map((j: any) => j.organizationId),
    );
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
        reminderJobConfigured: reminderConfigured.has(sub.organizationId),
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
    const { generateTotpSecret, otpauthUrl, qrDataUrlFor } = await import("../common/totp");
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
    // AP1: qrDataUrl is the same otpauth URL as a scannable PNG.
    const url = otpauthUrl(secret, actor.email);
    return { secret, otpauthUrl: url, qrDataUrl: await qrDataUrlFor(url), note: "Scan the QR code with your authenticator app (or enter the secret manually), then confirm with a 6-digit code. Until confirmation, two-factor stays OFF." };
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

  /** AA7 (C13): the admins roster — every platform admin in one
   * place. Assembled from the same rows securityOverview lists
   * (grant sets isSuperAdmin + adminTier together; the guard
   * requires the flag), extended with createdAt and a renamed
   * totpEnrolled boolean. Legacy admins (flag set, adminTier null)
   * operate as SUPER — the tier the M28 mutation gate and the
   * last-SUPER protection already assume — so the roster reports
   * "SUPER" for them rather than a misleading blank. The TOTP
   * SECRET is never selected; enrolment is a boolean only.
   * Read-only by design: grant/revoke stays on the user page. */
  async adminsRoster() {
    const rows = await (this.prisma as any).user.findMany({
      where: { isSuperAdmin: true },
      select: { id: true, email: true, name: true, adminTier: true, status: true, totpEnabled: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      admins: (rows as any[]).map((u) => ({
        id: u.id,
        name: u.name ?? null,
        email: u.email,
        tier: u.adminTier ?? "SUPER",
        status: u.status,
        totpEnrolled: u.totpEnabled === true,
        lastLoginAt: u.lastLoginAt ?? null,
        createdAt: u.createdAt ?? null,
      })),
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
    const [llm, meta, smtp, sms, ssl, bk, img, tt, gg, wal, li, goauth] = await Promise.all([
      this.rawConfigRow("llmConfig"), this.rawConfigRow("metaAppConfig"),
      this.rawConfigRow("smtpConfig"), this.rawConfigRow("smsConfig"),
      this.rawConfigRow("sslcommerzConfig"), this.rawConfigRow("bkashConfig"),
      this.rawConfigRow("imageConfig"),
      this.rawConfigRow("tiktokAppConfig"), this.rawConfigRow("googleAppConfig"),
      this.rawConfigRow("walletConfig"), this.rawConfigRow("linkedinAppConfig"), this.rawConfigRow("googleOAuthConfig"),
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
      image: {
        source: img?.provider ? "admin" : (process.env.IMAGE_PROVIDER ? "env" : "none"),
        provider: img?.provider ?? (process.env.IMAGE_PROVIDER || null),
        model: img?.model ?? (process.env.IMAGE_MODEL || null),
        secretConfigured: Boolean(img?.apiKeyEncrypted || process.env.IMAGE_API_KEY),
      },
      tiktokApp: {
        source: tt?.clientKey ? "admin" : (process.env.TIKTOK_CLIENT_KEY ? "env" : "none"),
        clientKey: tt?.clientKey ?? (process.env.TIKTOK_CLIENT_KEY || null),
        redirectUri: tt?.redirectUri ?? (process.env.TIKTOK_REDIRECT_URI || null),
        // The operator's own declaration that TikTok approved the
        // app for direct posting — unlocks the direct-post path;
        // it is never inferred from anything else.
        audited: tt ? tt.audited === true : process.env.TIKTOK_APP_AUDITED === "true",
        secretConfigured: Boolean(tt?.clientSecretEncrypted || process.env.TIKTOK_CLIENT_SECRET),
      },
      googleApp: {
        source: gg?.clientId ? "admin" : (process.env.GOOGLE_CLIENT_ID ? "env" : "none"),
        clientId: gg?.clientId ?? (process.env.GOOGLE_CLIENT_ID || null),
        redirectUri: gg?.redirectUri ?? (process.env.GOOGLE_REDIRECT_URI || null),
        secretConfigured: Boolean(gg?.clientSecretEncrypted || process.env.GOOGLE_CLIENT_SECRET),
      },
      linkedinApp: {
        source: li?.clientId ? "admin" : (process.env.LINKEDIN_CLIENT_ID ? "env" : "none"),
        clientId: li?.clientId ?? (process.env.LINKEDIN_CLIENT_ID || null),
        redirectUri: li?.redirectUri ?? (process.env.LINKEDIN_REDIRECT_URI || null),
        secretConfigured: Boolean(li?.clientSecretEncrypted || process.env.LINKEDIN_CLIENT_SECRET),
      },
      googleOAuth: {
        // AB8 (AX26): staff Google SSO — a SEPARATE app from
        // googleApp (YouTube). Admin-only by design: NO env
        // fallback is reported here, because there is none —
        // SSO must be an explicit operator act.
        source: goauth?.clientId ? "admin" : "none",
        clientId: goauth?.clientId ?? null,
        enabled: goauth ? goauth.enabled === true : false,
        secretConfigured: Boolean(goauth?.clientSecretEncrypted),
      },
      wallet: {
        // CC10: the platform fee on platform-gateway payments.
        // Unset ⇒ 0 — a fee is never invented.
        source: wal ? "admin" : "none",
        feeBps: wal && Number.isInteger(Number(wal.feeBps)) ? Number(wal.feeBps) : 0,
        // CC23: four-eyes payout threshold (minor units).
        // Null ⇒ the feature is off.
        payoutFourEyesThresholdMinor: wal && wal.payoutFourEyesThresholdMinor !== null && wal.payoutFourEyesThresholdMinor !== undefined
          && Number.isInteger(Number(wal.payoutFourEyesThresholdMinor)) && Number(wal.payoutFourEyesThresholdMinor) >= 0
          ? Number(wal.payoutFourEyesThresholdMinor)
          : null,
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
    const keyByArea: Record<string, string> = { llm: "llmConfig", meta: "metaAppConfig", smtp: "smtpConfig", sms: "smsConfig", sslcommerz: "sslcommerzConfig", bkash: "bkashConfig", image: "imageConfig", tiktok: "tiktokAppConfig", google: "googleAppConfig", wallet: "walletConfig", linkedin: "linkedinAppConfig", googleOAuth: "googleOAuthConfig" };
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
    } else if (area === "tiktok") {
      setField("clientKey", patch.clientKey === undefined ? undefined : String(patch.clientKey));
      setField("redirectUri", patch.redirectUri === undefined ? undefined : String(patch.redirectUri));
      if (patch.audited !== undefined) setField("audited", patch.audited === true);
      setSecret("clientSecret", "clientSecretEncrypted", patch.clientSecret, patch.clearSecret);
    } else if (area === "google") {
      setField("clientId", patch.clientId === undefined ? undefined : String(patch.clientId));
      setField("redirectUri", patch.redirectUri === undefined ? undefined : String(patch.redirectUri));
      setSecret("clientSecret", "clientSecretEncrypted", patch.clientSecret, patch.clearSecret);
    } else if (area === "linkedin") {
      setField("clientId", patch.clientId === undefined ? undefined : String(patch.clientId));
      setField("redirectUri", patch.redirectUri === undefined ? undefined : String(patch.redirectUri));
      setSecret("clientSecret", "clientSecretEncrypted", patch.clientSecret, patch.clearSecret);
    } else if (area === "googleOAuth") {
      // AB8 (AX26): staff SSO app. A blank/omitted clientSecret
      // keeps the stored secret (setSecret discipline, same as
      // every neighbour); `enabled` is the operator's explicit
      // switch — credentials alone never turn SSO on.
      setField("clientId", patch.clientId === undefined ? undefined : String(patch.clientId));
      if (patch.enabled !== undefined) setField("enabled", patch.enabled === true);
      setSecret("clientSecret", "clientSecretEncrypted", patch.clientSecret, patch.clearSecret);
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
    } else if (area === "wallet") {
      // CC10: platform wallet fee, basis points only — validated
      // server-side; the fee applied to a payment is whatever is
      // configured at the moment that payment is verified.
      if (patch.feeBps !== undefined) {
        const feeBps = Number(patch.feeBps);
        if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new BadRequestException("feeBps must be an integer 0-10000 (basis points)");
        setField("feeBps", feeBps);
      }
      // CC23: four-eyes payout threshold, minor units. null
      // CLEARS it (feature off); an integer ≥ 0 sets it.
      if (patch.payoutFourEyesThresholdMinor !== undefined) {
        if (patch.payoutFourEyesThresholdMinor === null) {
          setField("payoutFourEyesThresholdMinor", null);
        } else {
          const threshold = Number(patch.payoutFourEyesThresholdMinor);
          if (!Number.isInteger(threshold) || threshold < 0) throw new BadRequestException("payoutFourEyesThresholdMinor must be a non-negative integer (minor units) or null");
          setField("payoutFourEyesThresholdMinor", threshold);
        }
      }
    } else if (area === "image") {
      if (patch.provider !== undefined) {
        const p = String(patch.provider).toLowerCase();
        if (!["gemini", ""].includes(p)) throw new BadRequestException("image provider must be gemini");
        setField("provider", p);
      }
      setField("model", patch.model === undefined ? undefined : String(patch.model));
      setSecret("apiKey", "apiKeyEncrypted", patch.apiKey, patch.clearSecret);
    }

    // SP4 verify-before-save (image area only): when the merged
    // config names a real provider WITH a key, one minimal REAL
    // generation must succeed before anything is persisted. A
    // failure audits the attempt and throws — nothing is upserted
    // and the snapshot is not refreshed, so a broken key/model can
    // never silently become the live configuration. Skipped for
    // disable/clear-style saves (no provider or no key) and when
    // the secret itself is being cleared.
    let imageVerified: { model: string; latencyMs: number } | null = null;
    if (area === "image" && patch.clearSecret !== true) {
      const mergedProvider = typeof next.provider === "string" ? next.provider : "";
      const mergedKey = (typeof patch.apiKey === "string" && patch.apiKey)
        ? patch.apiKey
        : unseal(current.apiKeyEncrypted);
      if (mergedProvider === "gemini" && mergedKey) {
        const started = Date.now();
        try {
          const verifyProvider = buildImageProvider("gemini", mergedKey, next.model ? String(next.model) : undefined);
          const result = await Promise.race([
            verifyProvider.generate("A simple red circle centered on a plain white background."),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Image verification timed out after 30s")), 30_000)),
          ]);
          imageVerified = { model: result.model, latencyMs: Date.now() - started };
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown error";
          await this.logAdmin(actor, "platform_config_verify_failed", "SystemSetting", key, { area, error: message }, ip);
          throw new BadRequestException(`Image provider verification FAILED — the setting was NOT saved: ${message}`);
        }
      }
    }

    // AA3 verify-before-save, same discipline as SP4's image
    // block, for the two blocks whose probe is a TRUE credential
    // proof AND side-effect-free:
    //  - Meta: when the merged config holds an App ID + a secret,
    //    Meta must mint an app access token for them before the
    //    row is written.
    //  - bKash: when the merged config is complete (all four
    //    credential parts), a token grant must succeed first;
    //    the granted token is discarded, never stored.
    // SSLCommerz (init creates gateway-side session state),
    // TikTok and Google (partial client-auth probes only)
    // deliberately do NOT block saving — their test buttons are
    // the verification path. Skipped on clearSecret/clear, like
    // image.
    let metaVerified: { latencyMs: number } | null = null;
    if (area === "meta" && patch.clearSecret !== true) {
      const mergedAppId = typeof next.appId === "string" ? next.appId : "";
      const mergedSecret = (typeof patch.appSecret === "string" && patch.appSecret)
        ? patch.appSecret
        : unseal(current.appSecretEncrypted);
      if (mergedAppId && mergedSecret) {
        const version = (typeof next.graphVersion === "string" && next.graphVersion) || process.env.META_GRAPH_VERSION || "v21.0";
        const probe = await this.probeMetaApp(mergedAppId, mergedSecret, version);
        if (!probe.ok) {
          await this.logAdmin(actor, "platform_config_verify_failed", "SystemSetting", key, { area, error: probe.detail }, ip);
          throw new BadRequestException(`Meta app verification FAILED — the setting was NOT saved: ${probe.detail}`);
        }
        metaVerified = { latencyMs: probe.latencyMs };
      }
    }
    let bkashVerified: { latencyMs: number } | null = null;
    if (area === "bkash" && patch.clearSecret !== true) {
      const merged: BkashConfig = {
        appKey: typeof next.appKey === "string" ? next.appKey : "",
        username: typeof next.username === "string" ? next.username : "",
        appSecret: (typeof patch.appSecret === "string" && patch.appSecret) ? patch.appSecret : (unseal(current.appSecretEncrypted) ?? ""),
        password: (typeof patch.password === "string" && patch.password) ? patch.password : (unseal(current.passwordEncrypted) ?? ""),
        sandbox: next.sandbox !== false,
      };
      if (merged.appKey && merged.username && merged.appSecret && merged.password) {
        const probe = await this.probeBkashGrant(merged);
        if (!probe.ok) {
          await this.logAdmin(actor, "platform_config_verify_failed", "SystemSetting", key, { area, error: probe.detail }, ip);
          throw new BadRequestException(`bKash verification FAILED — the setting was NOT saved: ${probe.detail}`);
        }
        bkashVerified = { latencyMs: probe.latencyMs };
      }
    }

    await (this.prisma as any).systemSetting.upsert({
      where: { key }, create: { key, value: next, updatedById: actor.id }, update: { value: next, updatedById: actor.id },
    });
    await refreshPlatformConfig(this.prisma as any);
    await this.logAdmin(actor, "platform_config_updated", "SystemSetting", key, { area, changed }, ip);
    const configView = await this.getPlatformConfig();
    if (imageVerified) return { ...configView, imageVerification: { ok: true, model: imageVerified.model, latencyMs: imageVerified.latencyMs } };
    if (metaVerified) return { ...configView, metaVerification: { ok: true, latencyMs: metaVerified.latencyMs } };
    if (bkashVerified) return { ...configView, bkashVerification: { ok: true, latencyMs: bkashVerified.latencyMs } };
    return configView;
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

  /** A REAL minimal image generation against the configured
   * image provider (SP4). Success requires actual image bytes
   * back from the provider; failures surface its error verbatim. */
  async testImage() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveImageConfig();
    if (cfg.source === "none" || !cfg.provider) {
      throw new BadRequestException("No image provider is configured. Set a provider + API key above (or IMAGE_PROVIDER/IMAGE_API_KEY in env) first.");
    }
    const provider = buildImageProvider(cfg.provider, cfg.apiKey, cfg.model);
    const started = Date.now();
    try {
      const result = await Promise.race([
        provider.generate("A simple red circle centered on a plain white background."),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Image test timed out after 30s")), 30_000)),
      ]);
      return {
        ok: true, provider: cfg.provider, model: result.model, source: cfg.source,
        latencyMs: Date.now() - started, bytes: result.bytes.length, contentType: result.contentType,
      };
    } catch (e) {
      throw new BadRequestException(`Image test did NOT succeed: ${e instanceof Error ? e.message : "unknown error"}`);
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

  // ---------------- Admin Advanced AA3: verify the five blind-save blocks ----
  // Meta / SSLCommerz / bKash / TikTok / Google configs used to
  // save BLIND — a typo'd secret was discovered by a failing
  // tenant payment or OAuth. Each probe below performs the
  // cheapest REAL authentication-shaped call against the provider
  // with the EFFECTIVE config (admin -> env) and NEVER saves
  // anything. Unlike the older test methods (which throw), these
  // RETURN { ok, latencyMs, detail } — a missing config is an
  // honest ok:false result, not a 500, and a provider rejection
  // carries the provider's own words in `detail`.
  //
  // Proof classification (see docs/admin-aa3-acceptance.md):
  //  - Meta (client_credentials app-token mint) and bKash
  //    (token grant) are TRUE credential proofs -> they also run
  //    as verify-before-save in updatePlatformConfig.
  //  - SSLCommerz (session-init) proves gateway acceptance but
  //    creates an inert unpaid session on the gateway -> test
  //    button only, never on save.
  //  - TikTok / Google dummy-grant probes distinguish the
  //    providers' documented invalid_client (client REJECTED)
  //    from code/token errors (client ACCEPTED, dummy material
  //    refused as expected) -> client-auth proof only, labelled
  //    as such; they do not prove redirect-URI registration or
  //    API enablement, and never run on save.

  private probeFail(started: number, detail: string) {
    return { ok: false, latencyMs: Date.now() - started, detail };
  }

  private async probeMetaApp(appId: string, appSecret: string, graphVersion: string) {
    const started = Date.now();
    try {
      const qs = new URLSearchParams({ client_id: appId, grant_type: "client_credentials" });
      qs.set("client_secret", appSecret);
      const res = await fetch(`https://graph.facebook.com/${graphVersion}/oauth/access_token?${qs.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.access_token) {
        return { ok: true, latencyMs: Date.now() - started, detail: "Meta app access token ইস্যু করেছে — App ID ও App Secret সঠিক।" };
      }
      return this.probeFail(started, json?.error?.message ?? `Meta উত্তর দিয়েছে HTTP ${res.status} — কোনো app token পাওয়া যায়নি।`);
    } catch (e) {
      return this.probeFail(started, AdminService.errText(e));
    }
  }

  private async probeBkashGrant(cfg: BkashConfig) {
    const started = Date.now();
    try {
      const res = await fetch(`${bkashBase(cfg)}/token/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", username: cfg.username, password: cfg.password },
        body: JSON.stringify({ app_key: cfg.appKey, app_secret: cfg.appSecret }),
        signal: AbortSignal.timeout(20_000),
      });
      const json: any = await res.json().catch(() => null);
      if (json?.id_token) {
        return { ok: true, latencyMs: Date.now() - started, detail: "bKash token grant সফল — App Key/Secret ও Username/Password সঠিক। (প্রাপ্ত token সংরক্ষণ করা হয়নি।)" };
      }
      return this.probeFail(started, json?.statusMessage ?? json?.errorMessage ?? `bKash উত্তর দিয়েছে HTTP ${res.status} — কোনো token পাওয়া যায়নি।`);
    } catch (e) {
      return this.probeFail(started, AdminService.errText(e));
    }
  }

  private async probeSslcommerzInit(cfg: SslcommerzConfig) {
    const started = Date.now();
    const apiBase = (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
    const form = new URLSearchParams({
      store_id: cfg.storeId,
      store_passwd: cfg.storePass,
      total_amount: "10.00",
      currency: "BDT",
      tran_id: `ADMIN-VERIFY-${Date.now()}`,
      success_url: `${apiBase}/public/payments/sslcommerz/return`,
      fail_url: `${apiBase}/public/payments/sslcommerz/return`,
      cancel_url: `${apiBase}/public/payments/sslcommerz/return`,
      ipn_url: `${apiBase}/public/payments/sslcommerz/ipn`,
      product_name: "Admin config verification",
      product_category: "service",
      product_profile: "general",
      cus_name: "Admin Verify",
      cus_email: "verify@localhost",
      cus_phone: "01000000000",
      cus_add1: "Dhaka",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      ship_name: "Admin Verify",
      ship_add1: "Dhaka",
      ship_city: "Dhaka",
      ship_country: "Bangladesh",
      shipping_method: "NO",
    });
    try {
      const res = await fetch(`${sslcommerzBase(cfg)}/gwprocess/v4/api.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      });
      const json: any = await res.json().catch(() => null);
      if (json?.status === "SUCCESS" && json?.GatewayPageURL) {
        return {
          ok: true, latencyMs: Date.now() - started,
          detail: "SSLCommerz gateway session তৈরি করেছে — Store ID ও Password গৃহীত হয়েছে। এটি একটি আসল session-init পরীক্ষা: কোনো টাকা কাটা হয়নি, session-টি মেয়াদ শেষে নিজে মুছে যাবে।",
        };
      }
      const reason = String(json?.failed_reason ?? json?.status ?? `HTTP ${res.status}`);
      if (/store|password|credential/i.test(reason)) {
        return this.probeFail(started, `${reason} — SSLCommerz Store credential প্রত্যাখ্যান করেছে।`);
      }
      return this.probeFail(started, `${reason} — SSLCommerz session-init ব্যর্থ; কারণটি credential কিনা এই উত্তর থেকে নিশ্চিত বলা যায় না।`);
    } catch (e) {
      return this.probeFail(started, AdminService.errText(e));
    }
  }

  private async probeTiktokApp(cfg: { clientKey: string; clientSecret: string; redirectUri?: string }) {
    const started = Date.now();
    try {
      const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: (() => {
          const form = new URLSearchParams();
          form.set("client_key", cfg.clientKey);
          form.set("client_secret", cfg.clientSecret);
          form.set("code", "admin-verify-invalid-code");
          form.set("grant_type", "authorization_code");
          form.set("redirect_uri", socialOAuthRedirectUri("tiktok", cfg.redirectUri));
          return form.toString();
        })(),
        signal: AbortSignal.timeout(15_000),
      });
      const json: any = await res.json().catch(() => null);
      if (json?.access_token) {
        return { ok: true, latencyMs: Date.now() - started, detail: "TikTok token দিয়েছে — Client Key/Secret সঠিক।" };
      }
      const errStr = typeof json?.error === "string" ? json.error : (typeof json?.error?.code === "string" ? json.error.code : "");
      const errDesc = String(json?.error_description ?? json?.error?.message ?? "");
      if (errStr === "invalid_client") {
        return this.probeFail(started, errDesc || "TikTok client authentication ব্যর্থ (invalid_client) — Client Key/Secret প্রত্যাখ্যান করা হয়েছে।");
      }
      if (errStr) {
        // Any OTHER structured OAuth error means the client was
        // authenticated and only the deliberately-bogus code was
        // refused — the documented distinction this probe rests on.
        return {
          ok: true, latencyMs: Date.now() - started,
          detail: `TikTok client credential গৃহীত হয়েছে — dummy authorization code প্রত্যাখ্যান করা হয়েছে (প্রত্যাশিত; code-টি আসল নয়)। প্রমাণের সীমা: Client Key/Secret সঠিক — পূর্ণ প্রমাণের জন্য আসল user OAuth round-trip লাগবে। TikTok-এর উত্তর: ${errStr}${errDesc ? ` — ${errDesc}` : ""}`,
        };
      }
      return this.probeFail(started, `TikTok-এর উত্তর বোঝা যায়নি (HTTP ${res.status}) — credential যাচাই করা গেল না।`);
    } catch (e) {
      return this.probeFail(started, AdminService.errText(e));
    }
  }

  private async probeGoogleApp(cfg: { clientId: string; clientSecret: string }) {
    const started = Date.now();
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: (() => {
          const form = new URLSearchParams();
          form.set("client_id", cfg.clientId);
          form.set("client_secret", cfg.clientSecret);
          form.set("refresh_token", "admin-verify-invalid-token");
          form.set("grant_type", "refresh_token");
          return form.toString();
        })(),
        signal: AbortSignal.timeout(15_000),
      });
      const json: any = await res.json().catch(() => null);
      const errStr = typeof json?.error === "string" ? json.error : "";
      const errDesc = String(json?.error_description ?? "");
      if (errStr === "invalid_client") {
        return this.probeFail(started, errDesc || "Google client authentication ব্যর্থ (invalid_client) — Client ID/Secret প্রত্যাখ্যান করা হয়েছে।");
      }
      if (errStr === "invalid_grant") {
        // Google's documented distinction: invalid_grant is only
        // returned AFTER the client itself authenticated — the
        // deliberately-bogus refresh token is what was refused.
        return {
          ok: true, latencyMs: Date.now() - started,
          detail: `Google client credential গৃহীত হয়েছে — dummy refresh token প্রত্যাখ্যান করা হয়েছে (প্রত্যাশিত; token-টি আসল নয়)। প্রমাণের সীমা: Client ID/Secret Google চিনেছে — Redirect URI নিবন্ধন বা YouTube Data API চালু আছে কিনা এটি প্রমাণ করে না। Google-এর উত্তর: invalid_grant${errDesc ? ` — ${errDesc}` : ""}`,
        };
      }
      if (json?.access_token) {
        return { ok: true, latencyMs: Date.now() - started, detail: "Google access token দিয়েছে — Client ID/Secret সঠিক।" };
      }
      return this.probeFail(started, errDesc || `Google-এর উত্তর বোঝা যায়নি (HTTP ${res.status}) — credential যাচাই করা গেল না।`);
    } catch (e) {
      return this.probeFail(started, AdminService.errText(e));
    }
  }

  async testMeta() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = getPlatformConfigSync().metaApp;
    if (!cfg?.appId || !cfg?.appSecret) {
      return { ok: false, latencyMs: 0, detail: "Meta App configure করা নেই — যাচাইয়ের জন্য App ID ও App Secret দুটোই লাগবে। আগে সেভ করুন।" };
    }
    const version = cfg.graphVersion ?? process.env.META_GRAPH_VERSION ?? "v21.0";
    const probe = await this.probeMetaApp(cfg.appId, cfg.appSecret, version);
    return { ...probe, source: "admin" as const };
  }

  async testSslcommerz() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveSslcommerzConfig();
    if (!cfg) return { ok: false, latencyMs: 0, detail: "SSLCommerz configure করা নেই — Store ID ও Store Password সেভ করুন (বা env-তে দিন) তারপর যাচাই করুন।" };
    const probe = await this.probeSslcommerzInit(cfg);
    return { ...probe, sandbox: cfg.sandbox, source: cfg.source };
  }

  async testBkash() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveBkashConfig();
    if (!cfg) return { ok: false, latencyMs: 0, detail: "bKash configure করা নেই — App Key, App Secret, Username ও Password চারটিই লাগবে। আগে সেভ করুন।" };
    const probe = await this.probeBkashGrant(cfg);
    return { ...probe, sandbox: cfg.sandbox, source: cfg.source };
  }

  async testTiktok() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveTiktokAppConfig();
    if (!cfg) return { ok: false, latencyMs: 0, detail: "TikTok App configure করা নেই — Client Key ও Client Secret দুটোই লাগবে। আগে সেভ করুন।" };
    const probe = await this.probeTiktokApp(cfg);
    return { ...probe, source: cfg.source };
  }

  async testGoogle() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveGoogleAppConfig();
    if (!cfg) return { ok: false, latencyMs: 0, detail: "Google App configure করা নেই — Client ID ও Client Secret দুটোই লাগবে। আগে সেভ করুন।" };
    const probe = await this.probeGoogleApp(cfg);
    return { ...probe, source: cfg.source };
  }

  /** CC20: LinkedIn client-auth probe — the Google pattern: a
   * refresh_token grant with a deliberately bogus token. If
   * LinkedIn rejects the CLIENT (invalid_client) the credentials
   * are wrong; any token-level refusal means the client itself
   * authenticated. Proves client recognition only — NOT the
   * Community Management API approval LinkedIn gates posting
   * behind, and never runs on save. */
  private async probeLinkedinApp(cfg: { clientId: string; clientSecret: string }) {
    const started = Date.now();
    try {
      const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: (() => {
          const form = new URLSearchParams();
          form.set("client_id", cfg.clientId);
          form.set("client_secret", cfg.clientSecret);
          form.set("refresh_token", "admin-verify-invalid-token");
          form.set("grant_type", "refresh_token");
          return form.toString();
        })(),
        signal: AbortSignal.timeout(15_000),
      });
      const json: any = await res.json().catch(() => null);
      const errStr = typeof json?.error === "string" ? json.error : "";
      const errDesc = String(json?.error_description ?? "");
      if (errStr === "invalid_client") {
        return this.probeFail(started, errDesc || "LinkedIn client authentication ব্যর্থ (invalid_client) — Client ID/Secret প্রত্যাখ্যান করা হয়েছে।");
      }
      if (json?.access_token) {
        return { ok: true, latencyMs: Date.now() - started, detail: "LinkedIn access token দিয়েছে — Client ID/Secret সঠিক।" };
      }
      if (errStr) {
        return {
          ok: true, latencyMs: Date.now() - started,
          detail: `LinkedIn client credential গৃহীত হয়েছে — dummy refresh token প্রত্যাখ্যান করা হয়েছে (প্রত্যাশিত; token-টি আসল নয়)। প্রমাণের সীমা: Client ID/Secret LinkedIn চিনেছে — Community Management API অনুমোদন বা Redirect URI নিবন্ধন এটি প্রমাণ করে না। LinkedIn-এর উত্তর: ${errStr}${errDesc ? ` — ${errDesc}` : ""}`,
        };
      }
      return this.probeFail(started, `LinkedIn-এর উত্তর বোঝা যায়নি (HTTP ${res.status}) — credential যাচাই করা গেল না।`);
    } catch (e) {
      return this.probeFail(started, AdminService.errText(e));
    }
  }

  async testLinkedin() {
    await refreshPlatformConfig(this.prisma as any);
    const cfg = effectiveLinkedinAppConfig();
    if (!cfg) return { ok: false, latencyMs: 0, detail: "LinkedIn App configure করা নেই — Client ID ও Client Secret দুটোই লাগবে। আগে সেভ করুন।" };
    const probe = await this.probeLinkedinApp(cfg);
    return { ...probe, source: cfg.source };
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

  // ---------------- Milestone 38 (Phase A2): Support++ ----------------

  /**
   * View-as (impersonation), designed defensively: a 30-minute
   * token for a REAL member of the org (OWNER preferred), bound
   * to that one org, read-only unless a SUPER admin explicitly
   * asks for a write session. Starting a session needs a reason
   * and is audited. Ending = discarding the token client-side;
   * sessions are short-lived by design (documented limitation).
   */
  async startViewAs(actor: any, tier: string | undefined, organizationId: string, dto: { mode?: string; reason?: string }, ip?: string) {
    const why = this.requireReason(dto.reason);
    const mode = dto.mode === "write" ? "write" : "read";
    if (mode === "write" && tier !== "SUPER") {
      throw new ForbiddenException("Write view-as sessions require a SUPER admin");
    }
    if (!this.jwt) throw new BadRequestException("View-as is unavailable in this deployment (token service missing)");
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" },
    });
    if (!memberships.length) throw new BadRequestException("This organization has no active members to view as");
    const rank = (role: string) => (role === "OWNER" ? 0 : role === "ADMIN" ? 1 : 2);
    const targetMembership = [...memberships].sort((a: any, b: any) => rank(a.role) - rank(b.role))[0];
    const target = await (this.prisma as any).user.findUnique({ where: { id: targetMembership.userId } });
    if (!target || target.status !== "ACTIVE") throw new BadRequestException("The target member account is not active");
    // Admin Polish AP2: the session is registered server-side
    // FIRST; the token carries the session id and TenantGuard
    // requires the row to be live — so revocation is real.
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const session = await (this.prisma as any).viewAsSession.create({
      data: { adminId: actor.id, adminEmail: actor.email, targetUserId: target.id, organizationId, mode, reason: why, expiresAt },
    });
    const token = await this.jwt.signAsync(
      {
        sub: target.id, email: target.email, isSuperAdmin: false, tv: (target as any).tokenVersion ?? 0,
        viewAs: { adminId: actor.id, adminEmail: actor.email, orgId: organizationId, mode, sessionId: session.id },
      },
      { expiresIn: "30m" },
    );
    await this.logAdmin(actor, "view_as_started", "Organization", organizationId, {
      mode, reason: why, targetUserId: target.id, targetEmail: target.email, targetRole: targetMembership.role, sessionId: session.id,
    }, ip);
    const webBase = process.env.WEB_URL ?? "http://localhost:3000";
    return {
      token, mode, expiresInMinutes: 30, sessionId: session.id,
      organizationId, organizationName: org.name,
      targetUser: { id: target.id, email: target.email, role: targetMembership.role },
      url: `${webBase}/view-as?token=${encodeURIComponent(token)}&org=${organizationId}`,
    };
  }

  /** AP2: list view-as sessions (mine; SUPER sees everyone's),
   * newest first, with a computed active flag. */
  async listViewAsSessions(actor: any) {
    const where = actor?.adminTier === "SUPER" || actor?.isSuperAdmin ? {} : { adminId: actor.id };
    const rows = await (this.prisma as any).viewAsSession.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
    const now = Date.now();
    return rows.map((s: any) => ({ ...s, active: !s.revokedAt && new Date(s.expiresAt).getTime() > now }));
  }

  /** AP2: revoke a session server-side. Mine, or any for SUPER. */
  async revokeViewAsSession(actor: any, sessionId: string, ip?: string) {
    const s = await (this.prisma as any).viewAsSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException("View-as session not found");
    const isSuper = actor?.adminTier === "SUPER" || actor?.isSuperAdmin;
    if (s.adminId !== actor.id && !isSuper) throw new ForbiddenException("Only the session's admin (or a SUPER admin) can revoke it");
    if (s.revokedAt) return { ...s, active: false };
    const updated = await (this.prisma as any).viewAsSession.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedById: actor.id } });
    await this.logAdmin(actor, "view_as_revoked", "Organization", s.organizationId, { sessionId, mode: s.mode, targetUserId: s.targetUserId }, ip);
    return { ...updated, active: false };
  }

  /** Org 360: A1 history + orders, conversations, sync jobs, tickets. */
  async orgTimeline360(organizationId: string) {
    const base = await this.orgHistory(organizationId);
    const events: any[] = [...base.events];
    const [orders, conversations, integrations, tickets] = await Promise.all([
      (this.prisma as any).order.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
      (this.prisma as any).channelConversation.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
      (this.prisma as any).integration.findMany({ where: { organizationId } }).catch(() => []),
      (this.prisma as any).supportTicket.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
    ]);
    for (const o of orders as any[]) {
      events.push({ at: o.createdAt ?? o.placedAt, kind: "order", title: `অর্ডার ${o.externalNumber ?? String(o.id).slice(0, 8)}`, detail: `${o.status} · ${BigInt(o.totalMinor ?? 0).toString()} minor` });
    }
    for (const c of conversations as any[]) {
      events.push({ at: c.createdAt, kind: "conversation", title: `${c.channel} কথোপকথন`, detail: `${c.contactName ?? c.contactId ?? ""} · ${c.status}` });
    }
    const integrationIds = (integrations as any[]).map((i) => i.id);
    if (integrationIds.length) {
      const jobs = await (this.prisma as any).syncJob.findMany({
        where: { integrationId: { in: integrationIds } }, orderBy: { startedAt: "desc" }, take: 20,
      }).catch(() => []);
      for (const j of jobs as any[]) {
        events.push({ at: j.startedAt, kind: "sync", title: `${j.kind} sync · ${j.status}`, detail: j.error ? String(j.error).slice(0, 120) : `fetched ${j.fetched ?? 0}` });
      }
    }
    for (const t of tickets as any[]) {
      events.push({ at: t.createdAt, kind: "ticket", title: `🎫 ${t.subject}`, detail: `status: ${t.status}` });
    }
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { organizationId, organizationName: base.organizationName, events: events.slice(0, 100) };
  }

  private async onboardingStepsFor(organizationId: string) {
    const [profile, stores, products, integrations, adAccounts, members, campaigns] = await Promise.all([
      (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }).catch(() => null),
      (this.prisma as any).store.count({ where: { organizationId } }).catch(() => 0),
      (this.prisma as any).product.count({ where: { organizationId } }).catch(() => 0),
      (this.prisma as any).integration.count({ where: { organizationId } }).catch(() => 0),
      (this.prisma as any).adAccount.count({ where: { organizationId } }).catch(() => 0),
      (this.prisma as any).membership.count({ where: { organizationId, status: "ACTIVE" } }).catch(() => 0),
      (this.prisma as any).campaignPlan.count({ where: { organizationId } }).catch(() => 0),
    ]);
    const steps = [
      { key: "profile", label: "ব্যবসায়িক প্রোফাইল", done: !!(profile && (profile.description || profile.websiteUrl || profile.industry)) },
      { key: "store", label: "স্টোর কানেক্ট", done: stores > 0 },
      { key: "products", label: "পণ্য সিঙ্ক", done: products > 0 },
      { key: "integration", label: "চ্যানেল/ইন্টিগ্রেশন", done: integrations > 0 },
      { key: "meta", label: "Meta অ্যাড অ্যাকাউন্ট", done: adAccounts > 0 },
      { key: "team", label: "টিম সদস্য আমন্ত্রণ", done: members > 1 },
      { key: "campaign", label: "প্রথম ক্যাম্পেইন", done: campaigns > 0 },
    ];
    return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
  }

  async onboardingBoard() {
    const orgs = await (this.prisma as any).organization.findMany({ orderBy: { createdAt: "asc" }, take: 100 });
    const rows: any[] = [];
    for (const org of orgs as any[]) {
      const { steps, completed, total } = await this.onboardingStepsFor(org.id);
      const sub = await (this.prisma as any).subscription.findFirst({
        where: { organizationId: org.id }, orderBy: { createdAt: "desc" },
      }).catch(() => null);
      rows.push({
        organizationId: org.id, organizationName: org.name, createdAt: org.createdAt,
        plan: sub?.plan ?? null, subscriptionStatus: sub?.status ?? null,
        steps, completed, total,
        stuckAt: steps.find((s) => !s.done)?.label ?? null,
      });
    }
    rows.sort((a, b) => a.completed - b.completed);
    return rows;
  }

  /** Proactive alerts, all computed from real rows at read time. */
  async alertsBoard() {
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const alerts: any[] = [];
    const orgName = async (id: string) => {
      const org = await (this.prisma as any).organization.findUnique({ where: { id } }).catch(() => null);
      return org?.name ?? id;
    };
    // Broken integrations (status ERROR, from their own sync/connect flows).
    const integrations = await (this.prisma as any).integration.findMany({ take: 500 }).catch(() => []);
    for (const i of integrations as any[]) {
      if (i.status === "ERROR") {
        alerts.push({
          kind: "integration_error", severity: "high",
          organizationId: i.organizationId, organizationName: await orgName(i.organizationId),
          detail: `${i.provider}: ${i.lastError ?? "সংযোগে ত্রুটি"}`,
          at: i.updatedAt ?? i.createdAt,
        });
      }
    }
    // Sync jobs failing repeatedly in the last 24h (>= 2 per integration).
    const jobs = await (this.prisma as any).syncJob.findMany({
      where: { status: "FAILED", startedAt: { gte: new Date(now - dayMs) } }, take: 500,
    }).catch(() => []);
    const failByIntegration = new Map<string, number>();
    for (const j of jobs as any[]) failByIntegration.set(j.integrationId, (failByIntegration.get(j.integrationId) ?? 0) + 1);
    for (const [integrationId, count] of failByIntegration) {
      if (count < 2) continue;
      const integration = (integrations as any[]).find((i) => i.id === integrationId)
        ?? await (this.prisma as any).integration.findUnique({ where: { id: integrationId } }).catch(() => null);
      if (!integration) continue;
      alerts.push({
        kind: "sync_failing", severity: "high",
        organizationId: integration.organizationId, organizationName: await orgName(integration.organizationId),
        detail: `${integration.provider} sync গত ২৪ ঘণ্টায় ${count} বার ব্যর্থ`,
        at: new Date(now),
      });
    }
    // Subscription-driven alerts.
    const subs = await (this.prisma as any).subscription.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }).catch(() => []);
    const seenOrg = new Set<string>();
    for (const s of subs as any[]) {
      if (seenOrg.has(s.organizationId)) continue;
      seenOrg.add(s.organizationId);
      if (s.status === "PAST_DUE") {
        alerts.push({
          kind: "past_due", severity: "high",
          organizationId: s.organizationId, organizationName: await orgName(s.organizationId),
          detail: `সাবস্ক্রিপশন PAST_DUE (${s.plan}) — ওয়ার্কস্পেস Read-only`,
          at: s.updatedAt ?? s.createdAt,
        });
      } else if (s.status === "TRIALING" && s.currentPeriodEnd) {
        const msLeft = new Date(s.currentPeriodEnd).getTime() - now;
        if (msLeft > 0 && msLeft <= 3 * dayMs) {
          alerts.push({
            kind: "trial_expiring", severity: "medium",
            organizationId: s.organizationId, organizationName: await orgName(s.organizationId),
            detail: `ট্রায়াল শেষ হতে বাকি ${Math.ceil(msLeft / dayMs)} দিন (${new Date(s.currentPeriodEnd).toISOString().slice(0, 10)})`,
            at: s.updatedAt ?? s.createdAt,
          });
        }
      }
    }
    const order = { high: 0, medium: 1 } as Record<string, number>;
    alerts.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));
    return alerts;
  }

  /**
   * One-click nudge email for an alert kind. The text is built
   * from the org's real state server-side (no admin free text);
   * sends count only on provider confirmation.
   */
  async nudgeOrg(actor: any, organizationId: string, kind: string, ip?: string) {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    let subject = "";
    let text = "";
    if (kind === "onboarding") {
      const { steps } = await this.onboardingStepsFor(organizationId);
      const missing = steps.filter((s) => !s.done).map((s) => s.label);
      if (!missing.length) throw new BadRequestException("This organization has completed onboarding — nothing to nudge about");
      subject = "আপনার ওয়ার্কস্পেস সেটআপ শেষ করুন";
      text = `${org.name} — আপনার অ্যাকাউন্টে এখনও বাকি আছে: ${missing.join(", ")}।\n\nড্যাশবোর্ডের চেকলিস্ট থেকে ধাপগুলো শেষ করলেই সব ফিচার ব্যবহার করা যাবে। সাহায্য লাগলে এই ইমেইলের উত্তর দিন অথবা ওয়ার্কস্পেস থেকে Support Ticket খুলুন।`;
    } else if (kind === "trial_expiring") {
      subject = "আপনার ট্রায়াল শীঘ্রই শেষ হচ্ছে";
      text = `${org.name} — আপনার ট্রায়ালের মেয়াদ প্রায় শেষ। সেবা নিরবচ্ছিন্ন রাখতে ড্যাশবোর্ডের Billing পেজ থেকে প্ল্যান সক্রিয় করুন।`;
    } else if (kind === "past_due") {
      subject = "সাবস্ক্রিপশন পেমেন্ট বকেয়া";
      text = `${org.name} — আপনার সাবস্ক্রিপশন Past Due অবস্থায় আছে, তাই ওয়ার্কস্পেসটি বর্তমানে Read-only। Billing পেজ থেকে পেমেন্ট সম্পন্ন করলেই সব আবার চালু হবে।`;
    } else if (kind === "sync_failing" || kind === "integration_error") {
      subject = "আপনার ইন্টিগ্রেশনে সমস্যা ধরা পড়েছে";
      text = `${org.name} — আপনার কোনো স্টোর/চ্যানেল ইন্টিগ্রেশনের Sync ব্যর্থ হচ্ছে। ড্যাশবোর্ডের Integrations পেজে গিয়ে সংযোগটি পরীক্ষা করুন।`;
    } else {
      throw new BadRequestException(`Unknown nudge kind: ${kind}`);
    }
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    });
    const recipients = [...new Set((memberships as any[]).map((m) => m.user?.email).filter(Boolean))] as string[];
    const email = new EmailProvider();
    let sent = 0;
    for (const to of recipients) {
      await email.send({ to, subject, text });
      sent++;
    }
    await this.logAdmin(actor, "alert_nudged", "Organization", organizationId, { kind, recipients, sent }, ip);
    return { organizationId, kind, sent, recipients };
  }

  // ---------------- Milestone 40 (Phase A4): Control & Safety++ ----------------

  /** Console-managed admin IP allowlist (env entries always apply too). */
  async getIpAllowlist() {
    const value = await platformSetting(this.prisma as any, "adminIpAllowlist");
    const envEntries = (process.env.ADMIN_IP_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return { entries: Array.isArray(value) ? value : [], envEntries };
  }

  async setIpAllowlist(actor: any, entriesRaw: unknown, ip?: string) {
    if (!Array.isArray(entriesRaw)) throw new BadRequestException("entries must be an array of IPs or CIDR ranges");
    const entries = entriesRaw.map((e) => String(e).trim()).filter(Boolean);
    for (const entry of entries) {
      const [base, bits] = entry.split("/");
      const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(base) || /^[0-9a-fA-F:]+$/.test(base);
      if (!isIp) throw new BadRequestException(`Invalid allowlist entry: ${entry}`);
      if (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > 32)) {
        throw new BadRequestException(`Invalid CIDR range in entry: ${entry}`);
      }
    }
    await (this.prisma as any).systemSetting.upsert({
      where: { key: "adminIpAllowlist" },
      create: { key: "adminIpAllowlist", value: entries as any, updatedById: actor.id },
      update: { value: entries as any, updatedById: actor.id },
    });
    await this.logAdmin(actor, "ip_allowlist_updated", "SystemSetting", "adminIpAllowlist", { entries }, ip);
    return { entries };
  }

  // ---- Admin API keys (hashed at rest; raw key shown once) ----

  async listApiKeys() {
    const rows = await (this.prisma as any).adminApiKey.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []);
    return (rows as any[]).map((r) => ({
      id: r.id, name: r.name, keyPrefix: r.keyPrefix, createdById: r.createdById,
      // AP3: scopes ride along; [] means a legacy full-access key.
      scopes: (r as any).scopes ?? [],
      lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt, createdAt: r.createdAt,
    }));
  }

  async createApiKey(actor: any, nameRaw: string, ip?: string, scopesRaw?: unknown) {
    const name = String(nameRaw ?? "").trim();
    if (name.length < 3) throw new BadRequestException("API key name is required (min 3 characters)");
    // AP3: validate the requested grants against the catalog.
    const { validateScopes } = await import("../common/api-key-scopes");
    let scopes: string[];
    try { scopes = validateScopes(scopesRaw); }
    catch (e) { throw new BadRequestException(e instanceof Error ? e.message : "Invalid scopes"); }
    const { randomBytes, createHash } = await import("node:crypto");
    const raw = `qosa_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(raw).digest("hex");
    const row = await (this.prisma as any).adminApiKey.create({
      data: { name, keyPrefix: raw.slice(0, 12), keyHash, createdById: actor.id, scopes },
    });
    await this.logAdmin(actor, "api_key_created", "AdminApiKey", row.id, { name, scopes }, ip);
    return { id: row.id, name: row.name, keyPrefix: row.keyPrefix, scopes, key: raw, note: "This is the only time the full key is shown. Store it in a secrets manager." };
  }

  async revokeApiKey(actor: any, id: string, reasonRaw: string, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    const row = await (this.prisma as any).adminApiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("API key not found");
    if (row.revokedAt) throw new BadRequestException("This API key is already revoked");
    await (this.prisma as any).adminApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.logAdmin(actor, "api_key_revoked", "AdminApiKey", id, { name: row.name, reason }, ip);
    return { id, revoked: true };
  }

  // ---- Bulk org status ----

  async bulkOrgStatus(actor: any, organizationIds: string[], status: string, reason: string, ip?: string) {
    if (!Array.isArray(organizationIds) || organizationIds.length === 0) throw new BadRequestException("organizationIds is required");
    if (organizationIds.length > 50) throw new BadRequestException("Bulk actions are limited to 50 organizations at a time");
    const results: { organizationId: string; ok: boolean; error?: string }[] = [];
    for (const id of organizationIds) {
      try {
        await this.setOrgStatus(actor, id, status, reason, ip);
        results.push({ organizationId: id, ok: true });
      } catch (e) {
        results.push({ organizationId: id, ok: false, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return { status, total: results.length, succeeded: results.filter((r) => r.ok).length, results };
  }

  // ---- Login anomalies (from auth.login_failed audit rows) ----

  async loginAnomalies(hours = 24) {
    const since = new Date(Date.now() - Math.min(168, Math.max(1, hours)) * 3600000);
    const rows = await (this.prisma as any).auditLog.findMany({
      where: { action: "auth.login_failed", createdAt: { gte: since } }, take: 5000,
    }).catch(() => []);
    const byEmail = new Map<string, { email: string; failures: number; lastAt: Date }>();
    for (const r of rows as any[]) {
      const email = String(r.metadata?.email ?? "unknown");
      const cur = byEmail.get(email) ?? { email, failures: 0, lastAt: r.createdAt };
      cur.failures++;
      if (new Date(r.createdAt) > new Date(cur.lastAt)) cur.lastAt = r.createdAt;
      byEmail.set(email, cur);
    }
    return [...byEmail.values()]
      .filter((a) => a.failures >= 5)
      .sort((a, b) => b.failures - a.failures)
      .map((a) => ({ ...a, threshold: 5, note: "৫+ ব্যর্থ লগইন — অ্যাকাউন্টটি যাচাই করুন অথবা ব্যবহারকারীকে যোগাযোগ করুন" }));
  }

  // ---- Tenant data export & verified permanent deletion ----

  /**
   * Full data export for one org. Credential tables are NEVER
   * included — integrations export as provider/status metadata
   * only. Audited (admin.data_exported) with row counts.
   */
  async exportOrgData(actor: any, organizationId: string, ip?: string) {
    // AB8 (AX25): the bundle is built by the shared builder
    // (apps/api/src/organizations/org-data-export.ts); the admin
    // path returns its `legacyBundle` untouched, so this
    // endpoint's historical response shape is byte-identical.
    // Counts keep their historical semantics: computed over the
    // returned bundle's own entries.
    const { legacyBundle } = await buildOrgDataBundle(this.prisma as any, organizationId, { exportedBy: actor.email });
    const counts = Object.fromEntries(Object.entries(legacyBundle).map(([k, v]) => [k, Array.isArray(v) ? v.length : v ? 1 : 0]));
    await this.logAdmin(actor, "data_exported", "Organization", organizationId, { counts }, ip);
    return legacyBundle;
  }

  /**
   * Permanent deletion with a certificate. The org must already
   * be in DELETED status (soft state) and the caller must type
   * the org's exact name. Children are deleted by parent ids
   * first, then every org-keyed table, then membership/profile/
   * org. Platform-level audit rows (organizationId null,
   * including this certificate) survive; org-scoped audit rows
   * are deleted with the org. Tables are attempted defensively
   * and the certificate reports exactly what was deleted.
   */
  async deleteOrgPermanent(actor: any, organizationId: string, confirmName: string, reasonRaw: string, ip?: string) {
    const reason = this.requireReason(reasonRaw);
    const p = this.prisma as any;
    const org = await p.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException("Organization not found");
    if (org.status !== "DELETED") {
      throw new BadRequestException("Permanent deletion requires the organization to be in DELETED status first (soft-delete it, export its data, then delete permanently)");
    }
    if (String(confirmName ?? "") !== org.name) {
      throw new BadRequestException("Confirmation failed: type the organization's exact name to delete it permanently");
    }
    const certificate: Record<string, number> = {};
    const idsOf = async (table: string): Promise<string[]> => {
      try {
        const rows = await p[table]?.findMany({ where: { organizationId }, select: { id: true } });
        return (rows ?? []).map((r: any) => r.id);
      } catch { return []; }
    };
    const del = async (table: string, where: any) => {
      try {
        const res = await p[table]?.deleteMany({ where });
        if (res && typeof res.count === "number" && res.count > 0) certificate[table] = (certificate[table] ?? 0) + res.count;
      } catch { /* table/key absent in this schema version — skipped, not hidden: it simply has no rows here */ }
    };
    // Pass 1: children keyed by parent ids.
    const [conversationIds, orderIds, integrationIds, leadIds, productIds, competitorIds, broadcastIds, workflowIds, aiConversationIds, ticketIds, planIds] = await Promise.all([
      idsOf("channelConversation"), idsOf("order"), idsOf("integration"), idsOf("lead"), idsOf("product"),
      idsOf("competitor"), idsOf("broadcast"), idsOf("workflow"), idsOf("aIConversation"), idsOf("supportTicket"), idsOf("campaignPlan"),
    ]);
    if (ticketIds.length) await del("supportTicketMessage", { ticketId: { in: ticketIds } });
    if (conversationIds.length) {
      await del("channelMessage", { conversationId: { in: conversationIds } });
      await del("messageDraft", { conversationId: { in: conversationIds } });
      await del("conversationNote", { conversationId: { in: conversationIds } });
      await del("botSession", { conversationId: { in: conversationIds } });
    }
    if (orderIds.length) await del("orderItem", { orderId: { in: orderIds } });
    if (integrationIds.length) {
      await del("syncJob", { integrationId: { in: integrationIds } });
      await del("webhookEvent", { integrationId: { in: integrationIds } });
      await del("integrationCredential", { integrationId: { in: integrationIds } });
    }
    if (leadIds.length) await del("leadActivity", { leadId: { in: leadIds } });
    if (productIds.length) {
      await del("productVariant", { productId: { in: productIds } });
      await del("productCost", { productId: { in: productIds } });
    }
    if (competitorIds.length) {
      await del("competitorAd", { competitorId: { in: competitorIds } });
      await del("competitorPriceObservation", { competitorId: { in: competitorIds } });
    }
    if (broadcastIds.length) await del("messageDelivery", { broadcastId: { in: broadcastIds } });
    if (workflowIds.length) await del("workflowRun", { workflowId: { in: workflowIds } });
    if (aiConversationIds.length) {
      await del("aIMessage", { conversationId: { in: aiConversationIds } });
      await del("aIAction", { conversationId: { in: aiConversationIds } });
    }
    if (planIds.length) {
      // Ad sets hang off plans; ads hang off ad sets.
      let adSetIds: string[] = [];
      try {
        const sets = await p.campaignAdSet?.findMany({ where: { planId: { in: planIds } }, select: { id: true } }).catch(() => null)
          ?? await p.campaignAdSet?.findMany({ where: { campaignPlanId: { in: planIds } }, select: { id: true } }).catch(() => []);
        adSetIds = (sets ?? []).map((r: any) => r.id);
      } catch { /* none */ }
      if (adSetIds.length) await del("campaignAd", { adSetId: { in: adSetIds } });
      await del("campaignAdSet", { planId: { in: planIds } });
      await del("campaignAdSet", { campaignPlanId: { in: planIds } });
      await del("campaignPublishLog", { planId: { in: planIds } });
      await del("campaignPublishLog", { campaignPlanId: { in: planIds } });
    }
    // Pass 2: every org-keyed table (models without an
    // organizationId column throw inside Prisma and are skipped).
    const directTables = [
      "product", "productVariant", "productCost", "businessPolicy", "knowledgeDocument", "importJob",
      "store", "integration", "customer", "order", "visitor", "trackingSession", "touchpoint",
      "trackingEvent", "attributionCredit", "adAccount", "adCampaign", "dailyAdMetric", "dailyMetricAggregate",
      "dailyAdBreakdown", "aIConversation", "aIReport", "aIRecommendation", "aIUsageRecord",
      "channelConversation", "lead", "competitor", "competitorInsight", "campaignPlan",
      "scheduledJob", "automationRule", "automationRun", "messageTemplate", "broadcast", "workflow",
      "quickReply", "whatsAppTemplate", "inboxSetting", "botSession", "courierShipment",
      "paymentVerification", "widgetSite", "liveChatSession", "agentPresence", "agentNotification",
      "conversionApiSetting", "conversionEventLog", "creativeAsset", "audienceRecord", "savedAudience",
      "catalogRecord", "platformPublication", "reportShare", "productSet", "offlineConversionSetting",
      "offlineConversionLog", "adminNote", "orgFeatureFlag", "saasPayment", "memberInvitation",
      "planCheckout", "couponRedemption", "supportTicket", "usageRecord", "subscription",
    ];
    for (const table of directTables) await del(table, { organizationId });
    // Pass 3: org-scoped audit rows, membership, profile, the org.
    await del("auditLog", { organizationId });
    await del("membership", { organizationId });
    try { await p.businessProfile?.deleteMany({ where: { organizationId } }); } catch { /* ignore */ }
    await p.organization.delete({ where: { id: organizationId } });
    certificate.organization = 1;
    // The certificate lives in a PLATFORM audit row (no org) — it survives.
    await this.audit.log({
      userId: actor.id, action: "admin.org_deleted_permanently", entityType: "Organization", entityId: organizationId,
      metadata: { organizationName: org.name, reason, certificate }, ipAddress: ip,
    });
    return { organizationId, organizationName: org.name, deleted: true, certificate };
  }

  // ---------------- Milestone 42 (Phase A6): Reliability Panel ----------------

  private static readonly BOOT_TIME = new Date();

  /** Version & deploy facts — env-provided identity (GIT_SHA /
   * APP_VERSION can be set by the deploy platform) plus LIVE
   * migration state from the database itself. */
  async systemVersion() {
    const p = this.prisma as any;
    let migrations: { applied: number; latest: string | null; recent: string[] } | null = null;
    try {
      const rows = await p.$queryRawUnsafe(
        `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC`,
      );
      const list = (rows as any[]) ?? [];
      migrations = {
        applied: list.length,
        latest: list[0]?.migration_name ?? null,
        recent: list.slice(0, 5).map((r: any) => r.migration_name),
      };
    } catch { /* not a Postgres-backed Prisma (tests) — reported as null */ }
    let dbReachable = false;
    let dbLatencyMs: number | null = null;
    try {
      const t0 = Date.now();
      await p.organization.count();
      dbReachable = true;
      dbLatencyMs = Date.now() - t0;
    } catch { /* unreachable — reported honestly */ }
    return {
      appVersion: process.env.APP_VERSION ?? "dev",
      gitSha: process.env.GIT_SHA ?? process.env.APP_GIT_SHA ?? null,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV ?? "development",
      bootTime: AdminService.BOOT_TIME,
      uptimeSeconds: Math.floor((Date.now() - AdminService.BOOT_TIME.getTime()) / 1000),
      migrations,
      database: { reachable: dbReachable, latencyMs: dbLatencyMs },
      // Milestone 61: abuse-shield counters (this process).
      rateLimits: rateLimitStats.snapshot(),
    };
  }

  // ---------------- Admin Advanced AA1: Deploy Readiness ----------------
  // The owner's 2026-10-11 Dokploy redeploy failed because
  // INTERNAL_JOB_SECRET was missing from the compose env — and
  // nothing anywhere in the product could have told him before
  // the deploy. This checklist reports PRESENCE ONLY: a variable
  // is either set (non-empty) or not. Values are never read into
  // the response, never logged, never compared.
  //
  // Two groups, kept honest about what the API process can
  // attest:
  //  - "api": variables in THIS process's own environment.
  //  - "compose": variables that exist only at the Dokploy /
  //    compose layer (POSTGRES_PASSWORD is interpolated into
  //    DATABASE_URL by compose; APP_DOMAIN is interpolated into
  //    WEB_URL + the domain routing). The API cannot see them,
  //    so they are reported as unverifiable — never guessed from
  //    their derivatives.

  private static readonly ENV_REQUIRED: { name: string; hintBn: string }[] = [
    { name: "DATABASE_URL", hintBn: "ডাটাবেস সংযোগের ঠিকানা — এটি ছাড়া API চালুই হতে পারে না।" },
    { name: "JWT_SECRET", hintBn: "লগইন সেশনের সাইনিং secret — না থাকলে বা বদলালে সবাই লগআউট হয়ে যাবে।" },
    { name: "ENCRYPTION_KEY", hintBn: "সংরক্ষিত সব credential এই key দিয়ে খোলা হয় — না থাকলে কোনো integration-এর গোপন তথ্য পড়া যাবে না। বসানোর পর এটি কখনো বদলাবেন না।" },
    { name: "INTERNAL_JOB_SECRET", hintBn: "API ও Worker-এর মধ্যকার যাচাই secret — না থাকলে বা দুই পাশে না মিললে নির্ধারিত Job চলবে না। আগের একটি deploy ঠিক এই কারণেই আটকে গিয়েছিল।" },
  ];

  private static readonly ENV_OPTIONAL: { name: string; hintBn: string }[] = [
    { name: "REDIS_URL", hintBn: "Queue dispatch-এর জন্য — না থাকলে Job গুলো API-র ভেতরেই (inline) চলে এবং আলাদা Worker প্রসেস কোনো কাজ পায় না।" },
    { name: "API_PUBLIC_URL", hintBn: "API-র পাবলিক ঠিকানা — Social OAuth callback ও public link তৈরিতে লাগে।" },
    { name: "PUBLIC_API_URL", hintBn: "Telegram webhook স্বয়ংক্রিয় নিবন্ধনে লাগে — না থাকলে channel connect-এর সময় webhook হাতে নিবন্ধন করতে হয়।" },
    { name: "WEB_URL", hintBn: "Tenant অ্যাপের ঠিকানা — email/notification-এর link তৈরিতে লাগে। Dokploy-তে APP_DOMAIN থেকে compose এটি বানিয়ে দেয়।" },
    { name: "WORKER_HEALTH_URL", hintBn: "Worker-এর health endpoint-এর ঠিকানা (AA2) — না থাকলে ডিফল্ট http://worker:4100/health ধরে নেওয়া হয়।" },
    { name: "ADMIN_IP_ALLOWLIST", hintBn: "শুধু নির্দিষ্ট IP থেকে Admin প্রবেশের বাধা — না থাকলে যেকোনো নেটওয়ার্ক থেকে Admin লগইন সম্ভব (তখন TOTP-ই প্রধান সুরক্ষা)। Console থেকেও তালিকা রাখা যায়।" },
  ];

  private static readonly ENV_COMPOSE: { name: string; hintBn: string }[] = [
    { name: "POSTGRES_PASSWORD", hintBn: "Postgres কন্টেইনারের পাসওয়ার্ড — API প্রসেস এটি দেখতে পায় না; compose এটিকে DATABASE_URL-এর ভেতরে বসিয়ে দেয়। Dokploy-এর Environment ট্যাবে আছে কিনা মিলিয়ে দেখুন।" },
    { name: "APP_DOMAIN", hintBn: "Tenant অ্যাপের ডোমেইন — API এটি সরাসরি দেখে না; compose এটিকে WEB_URL বানিয়ে দেয় এবং Dokploy Domains ট্যাবে routing হয়। Environment ও Domains — দুই ট্যাবেই মিলিয়ে দেখুন।" },
  ];

  /** Locate the repo's prisma migrations directory, if the
   * running image carries it (the monorepo image does; a
   * stripped runtime may not — then pending stays unknown). */
  private migrationsDir(): string | null {
    // An explicit operator pointer is authoritative: if it is
    // set but wrong, pending stays honestly unknown instead of
    // silently falling back to a different directory.
    if (process.env.PRISMA_MIGRATIONS_DIR) {
      try { return existsSync(process.env.PRISMA_MIGRATIONS_DIR) ? process.env.PRISMA_MIGRATIONS_DIR : null; }
      catch { return null; }
    }
    const candidates: string[] = [];
    try {
      candidates.push(join(dirname(require.resolve("@repo/db/package.json")), "prisma", "migrations"));
    } catch { /* package not resolvable from here */ }
    candidates.push(join(process.cwd(), "packages/db/prisma/migrations"));
    candidates.push(join(process.cwd(), "../../packages/db/prisma/migrations"));
    for (const c of candidates) {
      try { if (existsSync(c)) return c; } catch { /* keep looking */ }
    }
    return null;
  }

  async systemEnvCheck() {
    const present = (name: string) => {
      const v = process.env[name];
      return typeof v === "string" && v.trim().length > 0;
    };
    const apiEnv = [
      ...AdminService.ENV_REQUIRED.map((e) => ({ name: e.name, required: true, present: present(e.name), hintBn: e.hintBn })),
      ...AdminService.ENV_OPTIONAL.map((e) => ({ name: e.name, required: false, present: present(e.name), hintBn: e.hintBn })),
    ];
    const requiredMissing = apiEnv.filter((e) => e.required && !e.present).length;

    // Migration readiness from the DB's own ledger (same source
    // as systemVersion) vs the repo directory when readable.
    let migrations: { applied: number; latest: string | null; repoTotal: number | null; pending: number | null; pendingNames: string[] } | null = null;
    try {
      const rows = await (this.prisma as any).$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC`,
      );
      const appliedNames = new Set(((rows as any[]) ?? []).map((r: any) => String(r.migration_name)));
      const latestApplied = ((rows as any[]) ?? [])[0]?.migration_name ?? null;
      let repoTotal: number | null = null;
      let pendingNames: string[] = [];
      let pending: number | null = null;
      const dir = this.migrationsDir();
      if (dir) {
        const repoNames = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d+_/.test(d.name))
          .map((d) => d.name)
          .sort();
        repoTotal = repoNames.length;
        pendingNames = repoNames.filter((n) => !appliedNames.has(n)).slice(0, 20);
        pending = repoNames.filter((n) => !appliedNames.has(n)).length;
      }
      migrations = {
        applied: appliedNames.size,
        latest: latestApplied ? String(latestApplied) : null,
        repoTotal,
        pending,
        pendingNames,
      };
    } catch { /* not a Postgres-backed Prisma (tests) — reported as null */ }

    // Platform-config source summary: the getPlatformConfig safe
    // view already computes admin/env/none per block without ever
    // exposing a secret — reuse it verbatim.
    const pc: any = await this.getPlatformConfig().catch(() => null);
    const areaLabels: [string, string][] = [
      ["llm", "AI / LLM"], ["metaApp", "Meta App"], ["smtp", "Email (SMTP)"], ["sms", "SMS"],
      ["sslcommerz", "SSLCommerz"], ["bkash", "bKash"], ["image", "AI Image"],
      ["tiktokApp", "TikTok App"], ["googleApp", "Google App"], ["linkedinApp", "LinkedIn App"],
    ];
    const platformConfig = areaLabels.map(([area, label]) => ({
      area,
      label,
      source: (pc?.[area]?.source as string) ?? "none",
      secretConfigured: Boolean(pc?.[area]?.secretConfigured ?? pc?.[area]?.appSecretConfigured),
    }));

    return {
      checkedAt: new Date().toISOString(),
      summary: {
        requiredTotal: AdminService.ENV_REQUIRED.length,
        requiredPresent: AdminService.ENV_REQUIRED.length - requiredMissing,
        requiredMissing,
        ready: requiredMissing === 0,
      },
      apiEnv,
      composeEnv: AdminService.ENV_COMPOSE.map((e) => ({ name: e.name, verifiable: false as const, hintBn: e.hintBn })),
      migrations,
      platformConfig,
    };
  }

  /** Work queues as they actually exist in this system: scheduled
   * jobs, store syncs, message deliveries, workflow runs. */
  /** Unified Inbox U6: platform-wide inbox health for the A6
   * reliability board — failed sends, webhook errors, channel
   * connection state and the unassigned backlog, all counted
   * from real rows. */
  async inboxHealth() {
    const since24 = new Date(Date.now() - 24 * 3600_000);
    const p = this.prisma as any;
    const failedSends = await p.channelMessage.count({
      where: { status: "failed", createdAt: { gte: since24 } },
    }).catch(() => 0);
    const latestFailures = await p.channelMessage.findMany({
      where: { status: "failed", createdAt: { gte: since24 } },
      orderBy: { createdAt: "desc" }, take: 5,
      select: { id: true, error: true, createdAt: true, conversationId: true },
    }).catch(() => []);
    const webhookErrors = await p.webhookEvent.count({
      where: { error: { not: null }, receivedAt: { gte: since24 } },
    }).catch(() => 0);
    const integrations = await p.integration.findMany({
      where: { provider: { in: ["whatsapp", "messenger", "instagram", "telegram", "email"] } },
      select: { provider: true, status: true, lastError: true, organizationId: true, updatedAt: true },
      take: 500,
    }).catch(() => []);
    const channelStates = integrations.map((i: any) => ({
      provider: i.provider, status: i.status, hasError: Boolean(i.lastError),
      organizationId: i.organizationId, updatedAt: i.updatedAt,
    }));
    const backlog = await p.channelConversation.count({
      where: { status: "open", assignedUserId: null },
    }).catch(() => 0);
    const oldestUnassigned = await p.channelConversation.findFirst({
      where: { status: "open", assignedUserId: null },
      orderBy: { createdAt: "asc" }, select: { createdAt: true },
    }).catch(() => null);
    const mediaStored = await p.channelMessage.count({
      where: { mediaStorageKey: { not: null } },
    }).catch(() => 0);
    return {
      windowHours: 24,
      failedSends24h: failedSends,
      latestFailures,
      webhookErrors24h: webhookErrors,
      channelStates,
      unassignedOpenBacklog: backlog,
      oldestUnassignedAt: oldestUnassigned?.createdAt ?? null,
      mediaStoredTotal: mediaStored,
      realtime: process.env.REDIS_URL
        ? "Redis bus configured (cross-instance fan-out)"
        : "In-process fan-out (single API instance; set REDIS_URL to scale out)",
    };
  }

  async systemQueues() {
    const p = this.prisma as any;
    const now = new Date();
    const dayAgo = new Date(Date.now() - 86400000);
    const [jobs, syncRunning, syncFailed, deliveries, workflowRunning, workflowErrors] = await Promise.all([
      p.scheduledJob?.findMany({ take: 1000 }).catch(() => []) ?? [],
      p.syncJob?.count({ where: { status: "RUNNING" } }).catch(() => 0) ?? 0,
      p.syncJob?.findMany({ where: { status: "FAILED", startedAt: { gte: dayAgo } }, orderBy: { startedAt: "desc" }, take: 5 }).catch(() => []) ?? [],
      p.messageDelivery?.findMany({ where: { createdAt: { gte: dayAgo } }, take: 5000 }).catch(() => []) ?? [],
      p.workflowRun?.count({ where: { status: "running" } }).catch(() => 0) ?? 0,
      p.workflowRun?.findMany({ where: { status: "error" }, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []) ?? [],
    ]);
    const jobRows = (jobs as any[]) ?? [];
    return {
      scheduledJobs: {
        total: jobRows.length,
        enabled: jobRows.filter((j) => j.enabled).length,
        dueNow: jobRows.filter((j) => j.enabled && j.nextRunAt && new Date(j.nextRunAt) <= now).length,
        recentlyFailed: jobRows
          .filter((j) => j.lastError && j.lastRunAt && new Date(j.lastRunAt) >= dayAgo)
          .slice(0, 5)
          .map((j) => ({ name: j.name, type: j.type, organizationId: j.organizationId, lastError: j.lastError, lastRunAt: j.lastRunAt })),
      },
      syncJobs: {
        running: syncRunning,
        failedLast24h: (syncFailed as any[]).length,
        latestFailures: (syncFailed as any[]).map((j) => ({ kind: j.kind, error: j.error, startedAt: j.startedAt })),
      },
      deliveries: {
        last24h: (deliveries as any[]).length,
        failedLast24h: (deliveries as any[]).filter((d) => d.status === "failed").length,
        pending: (deliveries as any[]).filter((d) => d.status === "queued" || d.status === "sending").length,
      },
      workflowRuns: {
        running: workflowRunning,
        latestErrors: (workflowErrors as any[]).map((r) => ({ organizationId: r.organizationId, error: r.error, createdAt: r.createdAt })),
      },
      // AA2: the live worker process + real BullMQ depths are
      // attached below (both failure-isolated — a dead worker or
      // Redis must never take the DB counts down with it).
      worker: await this.workerHealth(),
      bullmq: await this.bullmqCounts(),
    };
  }

  // ---------------- Admin Advanced AA2: Worker + BullMQ live view ----
  // Before AA2 the console showed only DOWNSTREAM symptoms of a
  // dead worker (due jobs piling up, webhooks processing inline)
  // — never the worker itself. Two real data sources, no
  // fabrication:
  //  - Liveness/uptime/redis/secret: the worker's own /health
  //    payload (WK2), passed through VERBATIM — it is the
  //    operator's own infrastructure reporting on itself.
  //  - Queue depths: read by the API directly from Redis. The
  //    API already depends on bullmq + ioredis and holds Queue
  //    handles for these exact queues ("scheduled-jobs" from
  //    AutomationService, "webhook" from WebhookDispatcher), so
  //    getJobCounts is the same data BullMQ itself maintains.
  //    The worker's /health carries NO counts, which is why the
  //    API reads Redis rather than proxying numbers the worker
  //    never reported.

  private _bullQueues = new Map<string, any>();

  private async bullQueue(name: string): Promise<any> {
    const cached = this._bullQueues.get(name);
    if (cached) return cached;
    const { Queue } = await import("bullmq");
    const { default: Redis } = await import("ioredis");
    const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null, connectTimeout: 3000 });
    connection.on("error", () => undefined); // surfaced via the counts call, not as an unhandled error
    const q = new Queue(name, { connection });
    this._bullQueues.set(name, q);
    return q;
  }

  private static errText(e: unknown): string {
    if (!(e instanceof Error)) return "unknown error";
    const cause = (e as any)?.cause;
    const causeMsg = cause instanceof Error ? cause.message : (typeof cause?.message === "string" ? cause.message : "");
    return causeMsg && !e.message.includes(causeMsg) ? `${e.message}: ${causeMsg}` : e.message;
  }

  /** BullMQ depths for the two queues that exist (WK1 rule: a
   * queue ships only with producer + processor). Never throws. */
  async bullmqCounts() {
    if (!process.env.REDIS_URL) {
      return {
        available: false,
        reason: "REDIS_URL সেট নেই — queue dispatch বন্ধ আছে; job গুলো API-র ভেতরেই (inline) চলে, BullMQ-তে কিছু জমে না।",
        queues: [] as any[],
      };
    }
    try {
      const work = (async () => {
        const queues: any[] = [];
        for (const name of ["scheduled-jobs", "webhook"]) {
          const q = await this.bullQueue(name);
          const c = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused");
          queues.push({
            name,
            waiting: Number(c?.waiting ?? 0), active: Number(c?.active ?? 0),
            delayed: Number(c?.delayed ?? 0), failed: Number(c?.failed ?? 0),
            completed: Number(c?.completed ?? 0), paused: Number(c?.paused ?? 0),
          });
        }
        return queues;
      })();
      const queues = await Promise.race([
        work,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis থেকে queue count পড়তে ৩ সেকেন্ডের বেশি লেগেছে")), 3000)),
      ]);
      return { available: true, queues };
    } catch (e) {
      return { available: false, error: AdminService.errText(e), queues: [] as any[] };
    }
  }

  // ---------------- Admin Next AB3 / AN12: Queue operator actions ----
  // AA2 made the queues board read-only; AN12 adds the operator
  // actions on the SAME Queue handles (bullQueue above) — pause,
  // resume, and a capped retry of failed jobs via the real
  // BullMQ job.retry(). There is deliberately NO drain, NO
  // obliterate and NO job deletion here (destructive; out of
  // scope for this package). When Redis is not configured the
  // actions return the same honest unavailable result as
  // bullmqCounts — never a fabricated success — and change
  // nothing. Every operational outcome (performed or
  // unavailable) is audited with before/after; validation
  // refusals (missing reason, unknown queue) throw before any
  // audit, matching the existing admin patterns.

  static readonly QUEUE_NAMES = ["scheduled-jobs", "webhook"] as const;
  static readonly QUEUE_RETRY_CAP = 50;

  private requireQueueName(name: string): string {
    if (!(AdminService.QUEUE_NAMES as readonly string[]).includes(name)) {
      throw new BadRequestException(`Unknown queue "${name}" — এই সিস্টেমে queue আছে: ${AdminService.QUEUE_NAMES.join(", ")}`);
    }
    return name;
  }

  /** Runs fn against the named queue with a hard timeout.
   * { ok:false } carries the verbatim error — callers turn it
   * into the honest unavailable result, never a success. */
  private async withQueue<T>(name: string, fn: (q: any) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    try {
      const q = await this.bullQueue(name);
      const value = await Promise.race([
        fn(q),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis-এ queue action ৫ সেকেন্ডের মধ্যে শেষ হয়নি")), 5000)),
      ]);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: AdminService.errText(e) };
    }
  }

  private queueUnavailable(name: string, action: string, error?: string) {
    return {
      available: false as const,
      queue: name,
      action,
      ...(error
        ? { error }
        : { reason: "REDIS_URL সেট নেই — queue dispatch বন্ধ আছে; job গুলো API-র ভেতরেই (inline) চলে, BullMQ-তে কোনো queue নেই যেটি pause/resume/retry করা যাবে।" }),
    };
  }

  async queuePause(actor: any, name: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    const queue = this.requireQueueName(name);
    if (!process.env.REDIS_URL) {
      const out = this.queueUnavailable(queue, "pause");
      await this.logAdmin(actor, "queue_pause_unavailable", "BullQueue", queue, { queue, reason: why, available: false }, ip);
      return out;
    }
    const r = await this.withQueue(queue, async (q) => {
      const before = Boolean(await q.isPaused());
      await q.pause();
      const after = Boolean(await q.isPaused());
      return { before, after };
    });
    if (!r.ok) {
      const out = this.queueUnavailable(queue, "pause", r.error);
      await this.logAdmin(actor, "queue_pause_unavailable", "BullQueue", queue, { queue, reason: why, available: false, error: r.error }, ip);
      return out;
    }
    await this.logAdmin(actor, "queue_paused", "BullQueue", queue,
      { queue, reason: why, before: { paused: r.value.before }, after: { paused: r.value.after } }, ip);
    return { available: true as const, queue, action: "pause", paused: r.value.after };
  }

  async queueResume(actor: any, name: string, reason?: string, ip?: string) {
    const why = this.requireReason(reason);
    const queue = this.requireQueueName(name);
    if (!process.env.REDIS_URL) {
      const out = this.queueUnavailable(queue, "resume");
      await this.logAdmin(actor, "queue_resume_unavailable", "BullQueue", queue, { queue, reason: why, available: false }, ip);
      return out;
    }
    const r = await this.withQueue(queue, async (q) => {
      const before = Boolean(await q.isPaused());
      await q.resume();
      const after = Boolean(await q.isPaused());
      return { before, after };
    });
    if (!r.ok) {
      const out = this.queueUnavailable(queue, "resume", r.error);
      await this.logAdmin(actor, "queue_resume_unavailable", "BullQueue", queue, { queue, reason: why, available: false, error: r.error }, ip);
      return out;
    }
    await this.logAdmin(actor, "queue_resumed", "BullQueue", queue,
      { queue, reason: why, before: { paused: r.value.before }, after: { paused: r.value.after } }, ip);
    return { available: true as const, queue, action: "resume", paused: r.value.after };
  }

  async queueRetryFailed(actor: any, name: string, opts: { jobIds?: string[]; limit?: number; reason?: string }, ip?: string) {
    const why = this.requireReason(opts?.reason);
    const queue = this.requireQueueName(name);
    const cap = Math.min(
      Math.max(1, Math.floor(typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? opts.limit : 20)),
      AdminService.QUEUE_RETRY_CAP,
    );
    const requestedIds = Array.isArray(opts?.jobIds) ? [...new Set(opts.jobIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))] : [];
    if (!process.env.REDIS_URL) {
      const out = this.queueUnavailable(queue, "retry-failed");
      await this.logAdmin(actor, "queue_retry_unavailable", "BullQueue", queue, { queue, reason: why, available: false }, ip);
      return out;
    }
    const r = await this.withQueue(queue, async (q) => {
      const countsBefore = await q.getJobCounts("failed").catch(() => ({} as any));
      const failedBefore = Number(countsBefore?.failed ?? 0);
      const jobs: any[] = [];
      if (requestedIds.length > 0) {
        for (const id of requestedIds.slice(0, cap)) {
          const job = await q.getJob(id).catch(() => null);
          jobs.push(job ?? { id, __missing: true });
        }
      } else {
        const failed = await q.getFailed(0, cap - 1);
        for (const job of (Array.isArray(failed) ? failed : [])) jobs.push(job);
      }
      const results: { id: string; retried: boolean; error?: string }[] = [];
      for (const job of jobs) {
        const id = String(job?.id ?? "");
        if (!id) continue;
        if (job.__missing) { results.push({ id, retried: false, error: "এই ID-র কোনো job পাওয়া যায়নি" }); continue; }
        try {
          const state = typeof job.getState === "function" ? await job.getState() : "failed";
          if (state !== "failed") { results.push({ id, retried: false, error: `job টি failed অবস্থায় নেই (এখন: ${state})` }); continue; }
          await job.retry();
          results.push({ id, retried: true });
        } catch (e) {
          results.push({ id, retried: false, error: AdminService.errText(e) });
        }
      }
      const countsAfter = await q.getJobCounts("failed").catch(() => ({} as any));
      return { failedBefore, failedAfter: Number(countsAfter?.failed ?? 0), results };
    });
    if (!r.ok) {
      const out = this.queueUnavailable(queue, "retry-failed", r.error);
      await this.logAdmin(actor, "queue_retry_unavailable", "BullQueue", queue, { queue, reason: why, available: false, error: r.error }, ip);
      return out;
    }
    const retriedCount = r.value.results.filter((x) => x.retried).length;
    await this.logAdmin(actor, "queue_retry_failed", "BullQueue", queue, {
      queue, reason: why,
      before: { failed: r.value.failedBefore }, after: { failed: r.value.failedAfter },
      requested: r.value.results.length, retried: retriedCount,
      jobIds: requestedIds.length > 0 ? requestedIds.slice(0, cap) : undefined,
    }, ip);
    return {
      available: true as const, queue, action: "retry-failed",
      failedBefore: r.value.failedBefore, failedAfter: r.value.failedAfter,
      requested: r.value.results.length, retried: retriedCount, results: r.value.results,
    };
  }

  /** One raw probe of the worker health URL. Deliberately
   * node:http(s), NOT fetch: the target is an internal compose
   * service address — it must never be routed through the
   * HTTP(S)_PROXY env proxies a host may export (in the sandbox
   * a proxied fetch to an unresolvable name leaves a hanging
   * socket behind even after abort). agent:false + a hard 2s
   * timeout + destroy tears the socket fully down either way.
   * Specs stub this method; production uses it as-is. */
  private probeWorkerHealth(url: string): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try { parsed = new URL(url); } catch { reject(new Error(`WORKER_HEALTH_URL সঠিক URL নয়: ${url}`)); return; }
      const get = parsed.protocol === "https:" ? httpsGet : httpGet;
      const req = get(parsed, { agent: false, timeout: 2000 }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => { size += c.length; if (size <= 65536) chunks.push(c); });
        res.on("end", () => {
          let body: unknown = null;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      });
      req.on("timeout", () => req.destroy(new Error("Worker health probe-এর সময় শেষ (2s)")));
      req.on("error", reject);
    });
  }

  /** Probe the worker's /health with a ~2s budget. A live but
   * DEGRADED worker answers HTTP 503 WITH its payload — that is
   * still "reachable", and the payload says degraded itself.
   * Never throws. */
  async workerHealth() {
    const healthUrl = process.env.WORKER_HEALTH_URL || "http://worker:4100/health";
    const checkedAt = new Date().toISOString();
    try {
      const { status, body } = await this.probeWorkerHealth(healthUrl);
      if (body && typeof body === "object" && !Array.isArray(body)) {
        return { reachable: true, healthUrl, checkedAt, health: body as Record<string, unknown> };
      }
      return { reachable: false, healthUrl, checkedAt, error: `Worker health endpoint অবৈধ উত্তর দিয়েছে (HTTP ${status})` };
    } catch (e) {
      return { reachable: false, healthUrl, checkedAt, error: AdminService.errText(e) };
    }
  }

  /** Error summary across every subsystem that records failures. */
  async systemErrors(hours = 24) {
    const p = this.prisma as any;
    const windowHours = Math.min(168, Math.max(1, hours));
    const since = new Date(Date.now() - windowHours * 3600000);
    const [automation, syncs, webhooks, deliveries, workflows] = await Promise.all([
      p.automationRun?.findMany({ where: { status: "error", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []) ?? [],
      p.syncJob?.findMany({ where: { status: "FAILED", startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take: 100 }).catch(() => []) ?? [],
      p.webhookEvent?.findMany({ where: { receivedAt: { gte: since } }, take: 500 }).catch(() => []) ?? [],
      p.messageDelivery?.findMany({ where: { status: "failed", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []) ?? [],
      p.workflowRun?.findMany({ where: { status: "error", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []) ?? [],
    ]);
    const webhookErrors = ((webhooks as any[]) ?? []).filter((w) => w.error);
    const sources = [
      { source: "automation_runs", count: (automation as any[]).length, latest: (automation as any[]).slice(0, 5).map((r) => ({ title: r.kind, detail: r.detail ?? null, at: r.createdAt })) },
      { source: "sync_jobs", count: (syncs as any[]).length, latest: (syncs as any[]).slice(0, 5).map((r) => ({ title: `${r.kind} sync`, detail: r.error ?? null, at: r.startedAt })) },
      { source: "webhooks", count: webhookErrors.length, latest: webhookErrors.slice(0, 5).map((r) => ({ title: `${r.provider}/${r.topic}`, detail: r.error ?? null, at: r.receivedAt })) },
      { source: "message_deliveries", count: (deliveries as any[]).length, latest: (deliveries as any[]).slice(0, 5).map((r) => ({ title: `${r.channel} → ${r.address}`, detail: r.error ?? null, at: r.createdAt })) },
      { source: "workflow_runs", count: (workflows as any[]).length, latest: (workflows as any[]).slice(0, 5).map((r) => ({ title: "workflow run", detail: r.error ?? null, at: r.createdAt })) },
    ];
    return { windowHours, totalErrors: sources.reduce((a, s) => a + s.count, 0), sources };
  }

  // ---------------- Admin Advanced AA6: Webhook explorer (C7) ----------------
  async systemWebhooks(filters: { provider?: string; organizationId?: string; hasError?: boolean; take?: number } = {}) {
    const p = this.prisma as any;
    let orgIntegrationIds: string[] | null = null;
    if (filters.organizationId) {
      const integrations = await p.integration.findMany({ where: { organizationId: filters.organizationId } }).catch(() => []);
      orgIntegrationIds = ((integrations as any[]) ?? []).map((i: any) => i.id);
      if (orgIntegrationIds.length === 0) return [];
    }
    const where: any = {};
    if (filters.provider) where.provider = filters.provider;
    if (filters.hasError) where.error = { not: null };
    if (orgIntegrationIds) where.integrationId = { in: orgIntegrationIds };
    const rows = await p.webhookEvent.findMany({
      where, orderBy: { receivedAt: "desc" }, take: Math.min(100, filters.take ?? 50),
    }).catch(() => []);
    const rowList: any[] = Array.isArray(rows) ? rows : [];
    const integrationIds = [...new Set(rowList.map((r: any) => r.integrationId).filter(Boolean))];
    let integrations: any[] = [];
    if (integrationIds.length > 0) {
      integrations = await p.integration.findMany({ where: { id: { in: integrationIds } } }).catch(() => []);
      if (!Array.isArray(integrations)) integrations = [];
    }
    const integrationById = new Map<string, any>(integrations.map((i: any) => [i.id, i]));
    const orgIds = [...new Set(integrations.map((i: any) => i.organizationId).filter(Boolean))];
    let orgs: any[] = [];
    if (orgIds.length > 0) {
      orgs = await p.organization.findMany({ where: { id: { in: orgIds } } }).catch(() => []);
      if (!Array.isArray(orgs)) orgs = [];
    }
    const nameOf = (id: string | null | undefined) => (orgs as any[]).find((o: any) => o.id === id)?.name ?? null;
    return rowList.map((r: any) => {
      const integration = integrationById.get(r.integrationId);
      const organizationId = integration?.organizationId ?? null;
      return {
        id: r.id, provider: r.provider, topic: r.topic ?? null,
        integrationId: r.integrationId,
        organizationId, organizationName: organizationId ? nameOf(organizationId) : null,
        deliveryId: r.deliveryId ?? null, signatureValid: r.signatureValid ?? false,
        processedAt: r.processedAt ?? null, error: r.error ?? null, receivedAt: r.receivedAt,
      };
    });
  }

  async systemWebhookEvent(id: string) {
    const p = this.prisma as any;
    const row = await p.webhookEvent.findUnique({ where: { id } }).catch(() => null);
    if (!row) throw new NotFoundException("Webhook event not found");
    let organizationId: string | null = null;
    let organizationName: string | null = null;
    if (row.integrationId) {
      const integration = await p.integration.findUnique({ where: { id: row.integrationId } }).catch(() => null);
      if (integration?.organizationId) {
        organizationId = integration.organizationId;
        const org = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
        organizationName = org?.name ?? null;
      }
    }
    const summary = {
      id: row.id, provider: row.provider, topic: row.topic ?? null,
      integrationId: row.integrationId,
      organizationId, organizationName,
      deliveryId: row.deliveryId ?? null, signatureValid: row.signatureValid ?? false,
      processedAt: row.processedAt ?? null, error: row.error ?? null, receivedAt: row.receivedAt,
    };
    const s = JSON.stringify(row.payload ?? null);
    if (s.length > 20000) {
      return { ...summary, payload: s.slice(0, 20000), payloadTruncated: true };
    }
    return { ...summary, payload: row.payload ?? null, payloadTruncated: false };
  }

  /** In-app activity log = the audit trail (process stdout is not
   * reachable from inside the app — stated on the panel). */
  async systemLogs(take = 100, q?: string, organizationId?: string) {
    const where: any = {};
    if (q) where.action = { contains: q };
    if (organizationId) where.organizationId = organizationId;
    const rows = await (this.prisma as any).auditLog.findMany({
      where, orderBy: { createdAt: "desc" }, take: Math.min(200, Math.max(1, take)),
    }).catch(() => []);
    return (rows as any[]).map((r) => ({
      at: r.createdAt, action: r.action, userId: r.userId, organizationId: r.organizationId,
      entityType: r.entityType, entityId: r.entityId, ip: r.ipAddress,
    }));
  }

  /** Database growth: real Postgres catalog stats when available,
   * delegate counts as the honest fallback. */
  async systemDbGrowth() {
    const p = this.prisma as any;
    try {
      const rows = await p.$queryRawUnsafe(
        `SELECT relname AS "table", n_live_tup::bigint AS "approxRows", pg_total_relation_size(relid)::bigint AS "bytes" FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 40`,
      );
      return {
        source: "pg_stat_user_tables",
        tables: (rows as any[]).map((r) => ({ table: r.table, approxRows: Number(r.approxRows), bytes: Number(r.bytes) })),
        totalBytes: (rows as any[]).reduce((a, r) => a + Number(r.bytes), 0),
      };
    } catch { /* fall through to counts */ }
    const core: [string, string][] = [
      ["Organization", "organization"], ["User", "user"], ["Order", "order"], ["Product", "product"],
      ["ChannelMessage", "channelMessage"], ["AuditLog", "auditLog"], ["AIUsageRecord", "aIUsageRecord"],
      ["DailyAdMetric", "dailyAdMetric"], ["Customer", "customer"], ["Lead", "lead"],
    ];
    const tables: { table: string; approxRows: number; bytes: null }[] = [];
    for (const [name, key] of core) {
      try { tables.push({ table: name, approxRows: await p[key].count(), bytes: null }); } catch { /* skip */ }
    }
    tables.sort((a, b) => b.approxRows - a.approxRows);
    return { source: "row counts (Postgres catalog unavailable)", tables, totalBytes: null };
  }

  // ---- Backup status (operator-recorded info + verifiable manifest) ----

  async getBackupPanel() {
    const [info, manifest] = await Promise.all([
      platformSetting(this.prisma as any, "backupInfo"),
      platformSetting(this.prisma as any, "backupManifest"),
    ]);
    return { info: (info as any) ?? null, manifest: (manifest as any) ?? null };
  }

  async setBackupInfo(actor: any, dto: { lastBackupAt?: string; location?: string; note?: string }, ip?: string) {
    const info = {
      lastBackupAt: dto.lastBackupAt ?? null,
      location: String(dto.location ?? "").slice(0, 200),
      note: String(dto.note ?? "").slice(0, 500),
      recordedBy: actor.email,
      recordedAt: new Date().toISOString(),
    };
    await (this.prisma as any).systemSetting.upsert({
      where: { key: "backupInfo" },
      create: { key: "backupInfo", value: info as any, updatedById: actor.id },
      update: { value: info as any, updatedById: actor.id },
    });
    await this.logAdmin(actor, "backup_info_updated", "SystemSetting", "backupInfo", { lastBackupAt: info.lastBackupAt }, ip);
    return info;
  }

  /**
   * One-click integrity manifest: live row counts across the core
   * tables. This is what the app can actually verify about its
   * own data — infra backups themselves live outside the app.
   */
  async verifyBackupManifest(actor: any, ip?: string) {
    const p = this.prisma as any;
    const core: [string, string][] = [
      ["Organization", "organization"], ["User", "user"], ["Membership", "membership"],
      ["Product", "product"], ["Order", "order"], ["Customer", "customer"], ["Lead", "lead"],
      ["ChannelConversation", "channelConversation"], ["ChannelMessage", "channelMessage"],
      ["CampaignPlan", "campaignPlan"], ["AuditLog", "auditLog"], ["SaasPayment", "saasPayment"],
      ["Subscription", "subscription"], ["SupportTicket", "supportTicket"], ["AIUsageRecord", "aIUsageRecord"],
    ];
    const tables: Record<string, number> = {};
    let totalRows = 0;
    for (const [name, key] of core) {
      try {
        const n = await p[key].count();
        tables[name] = n;
        totalRows += n;
      } catch { /* table unavailable in this deployment */ }
    }
    const manifest = { at: new Date().toISOString(), tables, totalRows, verifiedBy: actor.email };
    await (this.prisma as any).systemSetting.upsert({
      where: { key: "backupManifest" },
      create: { key: "backupManifest", value: manifest as any, updatedById: actor.id },
      update: { value: manifest as any, updatedById: actor.id },
    });
    await this.logAdmin(actor, "backup_verified", "SystemSetting", "backupManifest", { totalRows }, ip);
    return manifest;
  }

  // ---------------- Milestone 41 (Phase A5): Growth Ops ----------------

  /** Resolve campaign recipient emails for an audience. */
  private async campaignRecipients(audience: string, organizationIds?: string[]): Promise<{ organizationId: string; email: string }[]> {
    const p = this.prisma as any;
    let orgIds: string[] = [];
    if (organizationIds?.length) {
      orgIds = organizationIds.slice(0, 200);
    } else {
      const orgs = await p.organization.findMany({ where: { status: "ACTIVE" }, take: 1000 }).catch(() => []);
      if (audience === "all") {
        orgIds = (orgs as any[]).map((o) => o.id);
      } else {
        for (const o of orgs as any[]) {
          const tags = await this.orgAudienceTags(o.id);
          if (tags.includes(audience)) orgIds.push(o.id);
        }
      }
    }
    const members = await p.membership.findMany({
      where: { organizationId: { in: orgIds }, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" },
      take: 5000,
    }).catch(() => []);
    const users = await p.user.findMany({ where: { id: { in: [...new Set((members as any[]).map((m) => m.userId))] } } }).catch(() => []);
    const emailById = new Map((users as any[]).map((u) => [u.id, u.email]));
    const seen = new Set<string>();
    const out: { organizationId: string; email: string }[] = [];
    for (const m of members as any[]) {
      const email = emailById.get(m.userId);
      if (email && !seen.has(email)) { seen.add(email); out.push({ organizationId: m.organizationId, email }); }
    }
    return out;
  }

  async listCampaigns() {
    const rows = await (this.prisma as any).platformCampaign?.findMany({ orderBy: { createdAt: "desc" }, take: 30 }).catch(() => []) ?? [];
    return rows;
  }

  /**
   * Send a platform email campaign through the REAL EmailProvider.
   * An unconfigured provider refuses the whole campaign up front;
   * per-recipient outcomes are counted, never assumed.
   */
  async sendCampaign(actor: any, dto: { subject: string; body: string; audience: string; organizationIds?: string[] }, ip?: string) {
    if (!dto.subject?.trim() || !dto.body?.trim()) throw new BadRequestException("Campaign subject and body are required");
    if (dto.audience !== "all" && !AdminService.ANNOUNCEMENT_AUDIENCES.includes(dto.audience)) {
      throw new BadRequestException(`audience must be "all" or one of ${AdminService.ANNOUNCEMENT_AUDIENCES.join(", ")}`);
    }
    const recipients = await this.campaignRecipients(dto.audience, dto.organizationIds);
    if (recipients.length === 0) throw new BadRequestException("No recipients match this audience");
    if (recipients.length > 500) {
      throw new BadRequestException(`Audience resolves to ${recipients.length} recipients — over the 500 safety cap. Narrow the audience.`);
    }
    const email = new EmailProvider();
    let sent = 0;
    let failed = 0;
    let configError: string | null = null;
    for (const r of recipients) {
      try {
        await email.send({ to: r.email, subject: dto.subject.trim(), text: dto.body });
        sent++;
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        if (/not configured/i.test(message)) { configError = message; break; }
      }
    }
    if (configError && sent === 0) {
      throw new BadRequestException(`Email is not configured — no campaign email was sent. (${configError})`);
    }
    const row = await (this.prisma as any).platformCampaign.create({
      data: {
        subject: dto.subject.trim(), body: dto.body, audience: dto.audience,
        recipients: recipients.length, sent, failed, createdById: actor.id,
      },
    });
    await this.logAdmin(actor, "campaign_sent", "PlatformCampaign", row.id, { audience: dto.audience, recipients: recipients.length, sent, failed }, ip);
    return { ...row, note: configError ? `Sending stopped partway: ${configError}` : undefined };
  }

  // ---- Changelog ----

  async listChangelogAdmin() {
    return ((this.prisma as any).changelogEntry?.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => [])) ?? [];
  }
  async createChangelog(actor: any, dto: { version?: string; title: string; body: string; published?: boolean }, ip?: string) {
    if (!dto.title?.trim() || !dto.body?.trim()) throw new BadRequestException("Changelog title and body are required");
    const row = await (this.prisma as any).changelogEntry.create({
      data: {
        version: dto.version?.trim() || null, title: dto.title.trim(), body: dto.body,
        published: dto.published === true, publishedAt: dto.published === true ? new Date() : null,
      },
    });
    await this.logAdmin(actor, "changelog_created", "ChangelogEntry", row.id, { title: row.title, published: row.published }, ip);
    return row;
  }
  async updateChangelog(actor: any, id: string, dto: { version?: string; title?: string; body?: string; published?: boolean }, ip?: string) {
    const row = await (this.prisma as any).changelogEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Changelog entry not found");
    const data: any = {};
    if (dto.version !== undefined) data.version = dto.version.trim() || null;
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.published !== undefined) {
      data.published = dto.published;
      data.publishedAt = dto.published ? (row.publishedAt ?? new Date()) : null;
    }
    const updated = await (this.prisma as any).changelogEntry.update({ where: { id }, data });
    await this.logAdmin(actor, "changelog_updated", "ChangelogEntry", id, { published: updated.published }, ip);
    return updated;
  }
  async deleteChangelog(actor: any, id: string, ip?: string) {
    const row = await (this.prisma as any).changelogEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Changelog entry not found");
    await (this.prisma as any).changelogEntry.delete({ where: { id } });
    await this.logAdmin(actor, "changelog_deleted", "ChangelogEntry", id, { title: row.title }, ip);
    return { deleted: true };
  }
  async publicChangelog() {
    const rows = await (this.prisma as any).changelogEntry?.findMany({ where: { published: true }, orderBy: { publishedAt: "desc" }, take: 30 }).catch(() => []) ?? [];
    return (rows as any[]).map((r) => ({ id: r.id, version: r.version, title: r.title, body: r.body, publishedAt: r.publishedAt }));
  }

  // ---- Referrals board + config ----

  // --- Referral Advanced R4: campaign codes ---

  private campaignJson(c: any) {
    return {
      id: c.id, code: c.code, label: c.label, mode: c.mode ?? null,
      rewardMinor: c.rewardMinor != null ? c.rewardMinor.toString() : null,
      percentOfFirstPayment: c.percentOfFirstPayment ?? null,
      refereeBonusMinor: c.refereeBonusMinor != null ? c.refereeBonusMinor.toString() : null,
      minFirstPaymentMinor: c.minFirstPaymentMinor != null ? c.minFirstPaymentMinor.toString() : null,
      maxUses: c.maxUses ?? null, usedCount: c.usedCount, expiresAt: c.expiresAt ?? null,
      active: c.active, createdAt: c.createdAt,
      live: c.active && (!c.expiresAt || new Date(c.expiresAt) > new Date()) && (c.maxUses == null || c.usedCount < c.maxUses),
    };
  }

  async listReferralCampaigns() {
    const rows = await (this.prisma as any).referralCampaign?.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []) ?? [];
    return (rows as any[]).map((c) => this.campaignJson(c));
  }

  async createReferralCampaign(actor: any, dto: any, ip?: string) {
    const code = String(dto.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code)) throw new BadRequestException("code must be 3-24 chars of A-Z, 0-9, -");
    if (code.startsWith("QOS-")) throw new BadRequestException("codes starting with QOS- are reserved for user referral codes");
    if (!String(dto.label ?? "").trim()) throw new BadRequestException("label is required");
    const clash = await (this.prisma as any).referralCampaign.findUnique({ where: { code } }).catch(() => null);
    if (clash) throw new BadRequestException("a campaign with this code already exists");
    const money = (v: unknown, label: string) => {
      if (v === undefined || v === null || v === "") return null;
      const n = BigInt(Math.floor(Number(v)));
      if (n < 0n || n > 100000000n) throw new BadRequestException(`${label} out of range`);
      return n;
    };
    if (dto.mode !== undefined && dto.mode !== null && !["flat", "percent", "per_plan"].includes(dto.mode)) {
      throw new BadRequestException("mode must be flat | percent | per_plan");
    }
    const row = await (this.prisma as any).referralCampaign.create({
      data: {
        code, label: String(dto.label).trim(), mode: dto.mode ?? null,
        rewardMinor: money(dto.rewardMinor, "rewardMinor"),
        percentOfFirstPayment: dto.percentOfFirstPayment != null ? Math.min(100, Math.max(0, Math.floor(Number(dto.percentOfFirstPayment)))) : null,
        refereeBonusMinor: money(dto.refereeBonusMinor, "refereeBonusMinor"),
        minFirstPaymentMinor: money(dto.minFirstPaymentMinor, "minFirstPaymentMinor"),
        maxUses: dto.maxUses != null ? Math.max(1, Math.floor(Number(dto.maxUses))) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: actor.id,
      },
    });
    await this.logAdmin(actor, "referral_campaign_created", "ReferralCampaign", row.id, { code, label: row.label }, ip);
    return this.campaignJson(row);
  }

  async updateReferralCampaign(actor: any, id: string, dto: any, ip?: string) {
    const row = await (this.prisma as any).referralCampaign.findUnique({ where: { id } }).catch(() => null);
    if (!row) throw new NotFoundException("Campaign not found");
    const data: any = {};
    if (dto.label !== undefined) data.label = String(dto.label).trim();
    if (dto.active !== undefined) data.active = dto.active === true;
    if (dto.mode !== undefined) data.mode = dto.mode;
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses === null ? null : Math.max(1, Math.floor(Number(dto.maxUses)));
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.percentOfFirstPayment !== undefined) data.percentOfFirstPayment = dto.percentOfFirstPayment === null ? null : Math.min(100, Math.max(0, Math.floor(Number(dto.percentOfFirstPayment))));
    for (const f of ["rewardMinor", "refereeBonusMinor", "minFirstPaymentMinor"] as const) {
      if (dto[f] !== undefined) data[f] = dto[f] === null ? null : BigInt(Math.floor(Number(dto[f])));
    }
    const updated = await (this.prisma as any).referralCampaign.update({ where: { id }, data });
    await this.logAdmin(actor, "referral_campaign_updated", "ReferralCampaign", id, data, ip);
    return this.campaignJson(updated);
  }

  async referralsBoard() {
    const cfg = await referralConfig(this.prisma as any);
    const rows = await (this.prisma as any).referral?.findMany({ orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []) ?? [];
    const userIds = [...new Set((rows as any[]).flatMap((r) => [r.referrerUserId, r.referredUserId]))];
    const users = await (this.prisma as any).user.findMany({ where: { id: { in: userIds } } }).catch(() => []);
    const byId = new Map((users as any[]).map((u) => [u.id, u]));
    let paidOut = 0;
    const recent = (rows as any[]).slice(0, 30).map((r) => {
      if (r.status === "rewarded") paidOut += Number(r.rewardMinor ?? 0);
      return {
        id: r.id, code: r.code, status: r.status, createdAt: r.createdAt, rewardedAt: r.rewardedAt,
        rewardMinor: r.rewardMinor != null ? Number(r.rewardMinor) : null,
        referrerEmail: byId.get(r.referrerUserId)?.email ?? null,
        referredEmail: byId.get(r.referredUserId)?.email ?? null,
      };
    });
    // Referral Advanced R3: per-referrer aggregates + an
    // honest abuse watchlist (rules printed in the Admin UI).
    const all = await (this.prisma as any).referral?.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }).catch(() => []) ?? [];
    const byReferrer = new Map<string, any>();
    const dayAgo = Date.now() - 86400000;
    for (const r of all as any[]) {
      const e = byReferrer.get(r.referrerUserId) ?? {
        referrerUserId: r.referrerUserId, referrerEmail: byId.get(r.referrerUserId)?.email ?? null,
        signups: 0, rewarded: 0, earnedMinor: 0, signupsLast24h: 0,
      };
      e.signups++;
      if (r.status === "rewarded") { e.rewarded++; e.earnedMinor += Number(r.rewardMinor ?? 0); }
      if (new Date(r.createdAt).getTime() > dayAgo) e.signupsLast24h++;
      byReferrer.set(r.referrerUserId, e);
    }
    const referrers = [...byReferrer.values()]
      .map((e) => ({ ...e, conversionPercent: e.signups ? Math.round((e.rewarded / e.signups) * 1000) / 10 : null }))
      .sort((a, b) => b.signups - a.signups)
      .slice(0, 20);
    const flagged = referrers
      .filter((e) => (e.signups >= 10 && e.rewarded === 0) || e.signupsLast24h >= 5)
      .map((e) => ({
        ...e,
        flags: [
          ...(e.signups >= 10 && e.rewarded === 0 ? ["no_conversion"] : []),
          ...(e.signupsLast24h >= 5 ? ["signup_spike"] : []),
        ],
      }));
    return {
      config: cfg,
      totals: {
        signups: (all as any[]).length,
        rewarded: (all as any[]).filter((r: any) => r.status === "rewarded").length,
        clawedBack: (all as any[]).filter((r: any) => r.status === "clawed_back").length,
        paidOutMinor: (all as any[]).filter((r: any) => r.status === "rewarded").reduce((a: number, r: any) => a + Number(r.rewardMinor ?? 0), 0),
      },
      referrers,
      flagged,
      recent,
    };
  }

  async updateReferralConfig(actor: any, dto: {
    enabled: boolean; rewardMinor: number; mode?: string; percentOfFirstPayment?: number;
    perPlanMinor?: Record<string, number>; refereeBonusMinor?: number; minFirstPaymentMinor?: number;
    creditExpiryDays?: number; milestones?: { count: number; bonusMinor: number }[];
  }, ip?: string) {
    const rewardMinor = Math.floor(Number(dto.rewardMinor));
    if (!Number.isFinite(rewardMinor) || rewardMinor < 0 || rewardMinor > 100000000) {
      throw new BadRequestException("rewardMinor must be between 0 and 100000000 (minor units)");
    }
    const money = (v: unknown, label: string) => {
      if (v === undefined) return undefined;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 100000000) throw new BadRequestException(`${label} must be between 0 and 100000000 (minor units)`);
      return n;
    };
    // Merge over the stored config so a flat-only update
    // never wipes the v2 fields (and vice versa).
    const current = await referralConfig(this.prisma as any);
    const mode = dto.mode ?? current.mode;
    if (!["flat", "percent", "per_plan"].includes(mode)) throw new BadRequestException("mode must be flat | percent | per_plan");
    const percent = dto.percentOfFirstPayment === undefined ? current.percentOfFirstPayment : Math.floor(Number(dto.percentOfFirstPayment));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new BadRequestException("percentOfFirstPayment must be 0..100");
    const perPlan: Record<string, number> = { ...current.perPlanMinor };
    if (dto.perPlanMinor) {
      for (const [k, v] of Object.entries(dto.perPlanMinor)) {
        const n = money(v, `perPlanMinor.${k}`);
        if (n !== undefined) perPlan[String(k).toUpperCase()] = n;
      }
    }
    const milestones = dto.milestones === undefined ? current.milestones : dto.milestones.map((m) => {
      const count = Math.floor(Number(m?.count)); const bonusMinor = Math.floor(Number(m?.bonusMinor));
      if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(bonusMinor) || bonusMinor <= 0) {
        throw new BadRequestException("each milestone needs a positive count and bonusMinor");
      }
      return { count, bonusMinor };
    });
    const value = {
      enabled: dto.enabled === true,
      rewardMinor,
      mode,
      percentOfFirstPayment: percent,
      perPlanMinor: perPlan,
      refereeBonusMinor: money(dto.refereeBonusMinor, "refereeBonusMinor") ?? current.refereeBonusMinor,
      minFirstPaymentMinor: money(dto.minFirstPaymentMinor, "minFirstPaymentMinor") ?? current.minFirstPaymentMinor,
      creditExpiryDays: Math.min(3650, money(dto.creditExpiryDays, "creditExpiryDays") ?? current.creditExpiryDays),
      milestones,
    };
    await (this.prisma as any).systemSetting.upsert({
      where: { key: "referralConfig" },
      create: { key: "referralConfig", value: value as any, updatedById: actor.id },
      update: { value: value as any, updatedById: actor.id },
    });
    await this.logAdmin(actor, "referral_config_updated", "SystemSetting", "referralConfig", value, ip);
    return referralConfig(this.prisma as any);
  }

  // ---- Feedback / NPS board ----

  async feedbackBoard(take = 50) {
    const rows = await (this.prisma as any).feedback?.findMany({ orderBy: { createdAt: "desc" }, take: 500 }).catch(() => []) ?? [];
    const all = rows as any[];
    const promoters = all.filter((f) => f.score >= 9).length;
    const passives = all.filter((f) => f.score >= 7 && f.score <= 8).length;
    const detractors = all.filter((f) => f.score <= 6).length;
    const nps = all.length ? Math.round(((promoters - detractors) / all.length) * 100) : null;
    const average = all.length ? Math.round((all.reduce((a, f) => a + f.score, 0) / all.length) * 10) / 10 : null;
    const orgs = await (this.prisma as any).organization.findMany({
      where: { id: { in: [...new Set(all.map((f) => f.organizationId))] } },
    }).catch(() => []);
    const nameById = new Map((orgs as any[]).map((o) => [o.id, o.name]));
    return {
      summary: { count: all.length, average, promoters, passives, detractors, nps },
      recent: all.slice(0, Math.min(200, take)).map((f) => ({
        id: f.id, score: f.score, comment: f.comment, createdAt: f.createdAt,
        organizationId: f.organizationId, organizationName: nameById.get(f.organizationId) ?? null,
      })),
    };
  }

  // ---- Public pricing (from the operator's own settings) ----

  async publicPricing() {
    const prices = await planPrices(this.prisma as any);
    const yearly = await planYearlyPrices(this.prisma as any);
    const mergedLimits = await planLimits(this.prisma as any);
    const trialDays = await platformSetting(this.prisma as any, "trialDays").catch(() => null);
    return {
      currency: "BDT",
      trialDays: typeof trialDays === "number" ? trialDays : 14,
      plans: PLAN_TIERS.map((tier) => ({
        tier,
        priceMinor: (prices as any)[tier] ?? 0,
        yearlyPriceMinor: (yearly as any)[tier] ?? 0,
        limits: (mergedLimits as any)[tier] ?? {},
      })),
    };
  }
}
