import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BrainAdminService } from "../ai/brain-admin.service";
import { notFound } from "../i18n/api-exception";

/**
 * SA-B23 (Smart AI Phase 6, T1 console family): the SUPER
 * admin's per-org Brain VIEW — the platform-side mirror of the
 * tenant Learn Dashboard's overview (SA-B6), plus the
 * admin-only aggregates a tenant never sees about itself in
 * this shape (learned-item breakdown, configured autonomy
 * overrides, digest availability).
 *
 * The contents line, drawn deliberately and recorded in
 * docs/smart-ai-b23-acceptance.md:
 *  - COUNTS AND STATUS ONLY. Knowledge totals by visibility,
 *    Answer Store counts, learned-item counts, toggles,
 *    autonomy overrides, digest present/absent flags.
 *  - NO customer data. Customer memory appears as a COUNT —
 *    its contents (names, per-customer facts) stay invisible
 *    even here; the Item-2 forget is keyed, never browsed.
 *  - NO digest contents. Performance/ads/competitor digests
 *    are the org's internal business intelligence; the admin
 *    board records only whether each exists, not what it says.
 *    (The org's own staff read the digests in their surfaces.)
 *
 * Viewing is itself the sensitive act: EVERY call writes
 * exactly one audit row (`admin.ai_brain_view`, org-scoped,
 * actor = the live admin row) BEFORE returning — an operator
 * who looked at a tenant's Brain is on the record even if all
 * they did was look.
 *
 * Fixes live in AdminBrainFixService (same batch, Item 2).
 */
@Injectable()
export class AdminBrainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly brainAdmin: BrainAdminService,
  ) {}

  private db(): any {
    return this.prisma as any;
  }

  static readonly LEARNED_STATUSES = ["suggested", "approved", "rejected"] as const;
  static readonly LEARNED_SOURCE_TYPES = [
    "conversation",
    "unanswered",
    "website",
    "product",
    "performance",
    "ads",
    "creative",
    "competitor",
  ] as const;

  /** 404 unless the org exists — the admin surface never
   * fabricates an empty Brain for an org that is not there. */
  async getOrgOrThrow(organizationId: string) {
    const org = await this.db().organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        country: true,
        currency: true,
        timezone: true,
        verificationStatus: true,
        createdAt: true,
      },
    });
    if (!org) throw notFound("admin.organizationNotFound");
    return org;
  }

  async viewBrain(actor: any, organizationId: string, ip?: string) {
    const org = await this.getOrgOrThrow(organizationId);
    const db = this.db();

    // The SA-B6 computations, reused verbatim — the admin view
    // must never drift from what the tenant's own dashboard
    // reports about the same Brain.
    const overview = await this.brainAdmin.getOverview(organizationId);

    const [byStatus, bySourceType, autonomyRows, adsMetricCount, competitorCount] = await Promise.all([
      Promise.all(
        AdminBrainService.LEARNED_STATUSES.map(async (status) => ({
          status,
          count: await db.learnedItem.count({ where: { organizationId, status } }),
        })),
      ),
      Promise.all(
        AdminBrainService.LEARNED_SOURCE_TYPES.map(async (sourceType) => ({
          sourceType,
          count: await db.learnedItem.count({ where: { organizationId, sourceType } }),
        })),
      ),
      db.aiAutonomySetting.findMany({ where: { organizationId }, orderBy: { actionId: "asc" } }),
      db.dailyAdMetric.count({ where: { organizationId } }),
      db.competitor.count({ where: { organizationId } }),
    ]);

    const payload = {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        country: org.country,
        currency: org.currency,
        timezone: org.timezone,
        verificationStatus: org.verificationStatus,
        createdAt: org.createdAt instanceof Date ? org.createdAt.toISOString() : org.createdAt,
      },
      // Counts/status only — see the header for the line drawn.
      overview,
      learned: {
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
        bySourceType: Object.fromEntries(bySourceType.map((r) => [r.sourceType, r.count])),
      },
      autonomy: {
        // Configured overrides only; an action with no row
        // rides the engine default (L1 — approval required),
        // stated here so an empty list is never misread as
        // "everything is off".
        defaultLevel: 1,
        configured: (autonomyRows as any[]).map((r) => ({
          actionId: r.actionId,
          level: Number(r.level),
          updatedById: r.updatedById ?? null,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        })),
      },
      digests: {
        // Present/absent flags ONLY — never the contents.
        performance: overview.performance != null,
        ads: adsMetricCount > 0,
        competitor: competitorCount > 0,
      },
    };

    await this.audit.log({
      organizationId,
      userId: actor?.id,
      action: "admin.ai_brain_view",
      entityType: "Organization",
      entityId: organizationId,
      ipAddress: ip,
    });

    return payload;
  }
}
