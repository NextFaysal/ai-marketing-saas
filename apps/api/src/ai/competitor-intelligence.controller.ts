import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CompetitorIntelligenceService } from "./competitor-intelligence.service";
import { PermissionArea, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/**
 * SA-B17 (Smart AI Phase 4, C1): the tenant surface for
 * Competitor Brain — the deterministic digest over the
 * competitor data the org already collects (Ad Library sync
 * + price scanner rows). Any member may read; competitor
 * intelligence is INTERNAL class, so this is a member-gated
 * tenant route, never a public one. The write side files the
 * digest's findings into the LearnedItem review queue as
 * SUGGESTED facts (sourceType "competitor"; approval forces
 * INTERNAL). Same guard discipline as the A1/A3 controllers.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/competitor-intelligence")
@UseGuards(TenantGuard, RolesGuard)
export class CompetitorIntelligenceController {
  constructor(private readonly competitor: CompetitorIntelligenceService) {}

  /** Structured digest: activity (7d + 30d), creative-theme
   * counts, price series/movements and threshold findings. */
  @Get()
  digest(@Param("organizationId") orgId: string) {
    return this.competitor.computeDigest(orgId);
  }

  /** File the digest's findings as SUGGESTED LearnedItem
   * facts (sourceType "competitor"; approval forces
   * INTERNAL). Idempotent over unchanged data — the dedupe
   * wall absorbs re-runs. */
  @Post("suggest") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async suggest(@Param("organizationId") orgId: string) {
    const r = await this.competitor.suggestFindings(orgId);
    return { created: r.created, reason: r.reason ?? null, findings: r.digest.findings };
  }
}
