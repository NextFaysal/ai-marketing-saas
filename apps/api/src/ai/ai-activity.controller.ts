import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AiActivityService } from "./ai-activity.service";
import { PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * SA-B25 (Smart AI Phase 6, plan T4): the tenant AI Activity
 * API — the full feed + usage overview behind the tenant
 * Control Center's Activity view, completing the basics
 * SA-B13 shipped (proposal queue + latest-50 counts).
 *
 * Guard discipline mirrors ActionEngineController's reads:
 * TenantGuard + RolesGuard on the whole controller and BOTH
 * routes are member-level (no @Roles) — any org member may
 * see what the AI did in their own org. Org scoping itself
 * lives in AiActivityService's queries. The service owns ALL
 * validation (days window, kind, pagination clamps) so the
 * rules hold whichever caller reaches it.
 *
 * Honesty rules live in the service: events only from real
 * stamps on real rows; stored-answer hits are counters,
 * never feed rows; reviewedVia null stays null.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/ai/activity")
@UseGuards(TenantGuard, RolesGuard)
export class AiActivityController {
  constructor(private readonly activity: AiActivityService) {}

  @Get()
  feed(
    @Param("organizationId") orgId: string,
    @Query("kind") kind?: string,
    @Query("days") days?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.activity.getFeed(orgId, {
      kind,
      days,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get("usage")
  usage(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.activity.getUsage(orgId, { days });
  }
}
