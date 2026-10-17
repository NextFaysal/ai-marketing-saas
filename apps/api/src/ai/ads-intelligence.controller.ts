import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdsIntelligenceService } from "./ads-intelligence.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/**
 * SA-B14 (Smart AI Phase 3, A1): the tenant surface for Ads
 * Report Intelligence — the deterministic digest (any member
 * may read; ads numbers are INTERNAL class, so this is a
 * member-gated tenant route, never a public one) and the two
 * write-side acts: filing the digest's top findings into the
 * LearnedItem review queue, and asking for a guarded LLM
 * narration of the computed facts. Same guard discipline as
 * LearningController.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/ads-intelligence")
@UseGuards(TenantGuard, RolesGuard)
export class AdsIntelligenceController {
  constructor(private readonly ads: AdsIntelligenceService) {}

  /** ?days=7|30 (anything else reads as the 7-day default). */
  @Get()
  digest(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.ads.computeDigest(orgId, { days: days === "30" ? 30 : 7 });
  }

  /** File the top findings as SUGGESTED LearnedItem facts
   * (sourceType "ads"; approval forces INTERNAL). Idempotent
   * within a period — the dedupe wall absorbs re-runs. */
  @Post("suggest") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async suggest(@Param("organizationId") orgId: string, @Body() dto?: { days?: number }) {
    const r = await this.ads.suggestFindings(orgId, { days: dto?.days === 30 ? 30 : 7 });
    return { created: r.created, reason: r.reason ?? null, findings: r.digest.findings };
  }

  /** Guarded narration: the org's LLM restates the computed
   * fact lines; the number guard drops the whole narration if
   * it utters one unsupported number (narration null + the
   * labelled note say so — the digest is returned either way). */
  @Post("narrate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  narrate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto?: { days?: number }) {
    return this.ads.narrate(orgId, user.userId, { days: dto?.days === 30 ? 30 : 7 });
  }
}
