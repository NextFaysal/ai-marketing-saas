import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CreativeLearningService } from "./creative-learning.service";
import { PermissionArea, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/**
 * SA-B16 (Smart AI Phase 3, A3): the tenant surface for
 * Creative Intelligence — the deterministic pattern report
 * over the org's own hub-built ad creatives (any member may
 * read; creative performance is INTERNAL class, so this is a
 * member-gated tenant route, never a public one) and the
 * write-side act of filing the reported patterns into the
 * LearnedItem review queue. The exemplars in the report are
 * read-through from the source CampaignAd rows — Phase 5's
 * content generator consumes the same service method. Same
 * guard discipline as AdsIntelligenceController.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/creative-intelligence")
@UseGuards(TenantGuard, RolesGuard)
export class CreativeIntelligenceController {
  constructor(private readonly creative: CreativeLearningService) {}

  /** Pattern report + top exemplars (trailing 30 days). */
  @Get()
  report(@Param("organizationId") orgId: string) {
    return this.creative.computeReport(orgId);
  }

  /** File the reported patterns as SUGGESTED LearnedItem
   * facts (sourceType "creative"; approval forces INTERNAL).
   * Idempotent within a window — the dedupe wall absorbs
   * re-runs. */
  @Post("suggest") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async suggest(@Param("organizationId") orgId: string) {
    const r = await this.creative.suggestPatterns(orgId);
    return { created: r.created, reason: r.reason ?? null, patterns: r.report.patterns.map((p) => p.statement) };
  }
}
