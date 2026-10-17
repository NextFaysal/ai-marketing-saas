import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { SuperAdminGuard, AdminTier } from "../common/super-admin.guard";
import { PlatformTeachingService } from "./platform-teaching.service";
import { LearningSourcesService } from "./learning-sources.service";
import { AdminBrainService } from "./admin-brain.service";
import { AdminBrainFixService } from "./admin-brain-fix.service";
import { AdminOversightService } from "./admin-oversight.service";
import {
  ForgetCustomerMemoryDto,
  InvalidateAnswerDto,
  ReviewLearnedItemDto,
  SetAnswerStoreEnabledDto,
} from "./admin-brain.dto";
import { SetGlobalPauseDto, SetOrgAiDisabledDto } from "./admin-oversight.dto";
import { CreateTeachingDto, SetTeachingEnabledDto, UpdateTeachingDto } from "./platform-teaching.dto";

/**
 * SA-B22 (Smart AI Phase 6, T1): the Admin Training Console's
 * API — platform teaching (this controller) under /admin/ai/*.
 *
 * SUPER ONLY, harder than the AdminController default: the
 * class-level @AdminTier("SUPER") means even READS refuse other
 * admin tiers, and a tenant user (incl. an org OWNER) is not a
 * platform admin at all, so the SuperAdminGuard's live-row
 * check refuses them with 403 before any handler runs. On top
 * of that the guard's TOTP rule applies: a SUPER without
 * two-factor may read but cannot mutate.
 *
 * Teaching written here is platform GUIDANCE — the Brain
 * wiring (OrgBrainService.platformGuidance) keeps it out of
 * every fact channel by construction; see
 * platform-teaching.service.ts and docs/smart-ai-b22-acceptance.md.
 */
@Controller("admin/ai")
@UseGuards(SuperAdminGuard)
@AdminTier("SUPER")
export class AdminAiController {
  constructor(
    private readonly teaching: PlatformTeachingService,
    private readonly sources: LearningSourcesService,
    private readonly brain: AdminBrainService,
    private readonly fixes: AdminBrainFixService,
    private readonly oversight: AdminOversightService,
  ) {}

  /** SA-B24 (plan T3): the AI Oversight board — cross-org
   * aggregates over a 7/30-day window, computed from real
   * proposal/usage/answer/learned rows (counts and identity
   * only; tenant contents stay behind the audited SA-B23
   * per-org view above). */
  @Get("oversight")
  oversightBoard(@Query("days") days?: string) {
    return this.oversight.board(days);
  }

  /** SA-B24 (plan T3): the kill-switch state — the global
   * pause (with its last flip's provenance) and the per-org
   * disabled list (with per-org flip provenance where the
   * T3 endpoint stamped it). */
  @Get("kill-switch")
  killSwitchState() {
    return this.oversight.getKillSwitch();
  }

  /** SA-B24: flip the GLOBAL AI pause. A non-empty `reason`
   * is required in BOTH directions and is audit-logged
   * verbatim (`admin.ai_kill_switch_global_pause|resume`).
   * While paused: LLM-backed generation/composition refuses,
   * the Action Engine files proposals but executes nothing,
   * and LLM-calling sweeps skip with the recorded reason —
   * deterministic surfaces (digests, stored-answer serving)
   * keep working. See admin-oversight.service.ts. */
  @Put("kill-switch/global")
  setGlobalPause(@Req() req: any, @Body() dto: SetGlobalPauseDto) {
    return this.oversight.setGlobalPause(req.adminUser, dto?.paused, dto?.reason, req.ip);
  }

  /** SA-B24: flip ONE org's AI disable (the T3 "org বেছে
   * kill switch") — the same reason+audit discipline,
   * org-scoped audit row
   * (`admin.ai_kill_switch_org_disable|enable`). Writes the
   * same killSwitches row's aiDisabledOrgIds list the
   * per-org switch has always lived in. */
  @Put("kill-switch/orgs/:organizationId")
  setOrgDisabled(
    @Req() req: any,
    @Param("organizationId") organizationId: string,
    @Body() dto: SetOrgAiDisabledDto,
  ) {
    return this.oversight.setOrgDisabled(req.adminUser, organizationId, dto?.disabled, dto?.reason, req.ip);
  }

  /** SA-B22 (plan T2): the Sources Registry — the plan's 14
   * learning sources with their real producing service,
   * storage, gate and live counters. Admin-only by design:
   * there is deliberately NO tenant-side registry endpoint —
   * a tenant sees its own sources in its Learn Dashboard
   * (SA-B6), this platform-wide truth board is an operator
   * instrument. */
  @Get("learning-sources")
  learningSources() {
    return this.sources.registry();
  }

  /** SA-B23 (T1 console family): the per-org Brain VIEW for
   * SUPER admins — counts/status only (no customer data, no
   * digest contents; the line is drawn in
   * admin-brain.service.ts). Viewing is itself the sensitive
   * act: the service writes exactly one `admin.ai_brain_view`
   * audit row per call. The FIX routes arrive with Item 2 of
   * the same batch (admin-brain-fix.service.ts). */
  @Get("orgs/:organizationId/brain")
  viewOrgBrain(@Req() req: any, @Param("organizationId") organizationId: string) {
    return this.brain.viewBrain(req.adminUser, organizationId, req.ip);
  }

  /** SA-B23 fixes — every one requires a non-empty `reason`
   * (validated in AdminBrainFixService BEFORE any mutation;
   * an empty reason is a 400 with zero state change and zero
   * fix-audit), runs through the tenant's own service paths
   * with the ADMIN as the recorded actor, and writes its own
   * org-scoped `admin.ai_brain_fix_*` audit row carrying the
   * reason verbatim. See admin-brain-fix.service.ts. */
  @Post("orgs/:organizationId/answer-store/:answerId/invalidate")
  invalidateStoredAnswer(
    @Req() req: any,
    @Param("organizationId") organizationId: string,
    @Param("answerId") answerId: string,
    @Body() dto: InvalidateAnswerDto,
  ) {
    return this.fixes.invalidateAnswer(req.adminUser, organizationId, answerId, dto?.reason, req.ip);
  }

  @Post("orgs/:organizationId/learned-items/:itemId/review")
  reviewLearnedItem(
    @Req() req: any,
    @Param("organizationId") organizationId: string,
    @Param("itemId") itemId: string,
    @Body() dto: ReviewLearnedItemDto,
  ) {
    return this.fixes.reviewLearnedItem(req.adminUser, organizationId, itemId, dto?.decision, dto?.reason, req.ip);
  }

  @Post("orgs/:organizationId/customer-memories/forget")
  forgetCustomerMemory(
    @Req() req: any,
    @Param("organizationId") organizationId: string,
    @Body() dto: ForgetCustomerMemoryDto,
  ) {
    return this.fixes.forgetCustomerMemory(req.adminUser, organizationId, dto?.customerKey, dto?.reason, req.ip);
  }

  @Post("orgs/:organizationId/answer-store-toggle")
  setAnswerStoreEnabled(
    @Req() req: any,
    @Param("organizationId") organizationId: string,
    @Body() dto: SetAnswerStoreEnabledDto,
  ) {
    return this.fixes.setAnswerStoreEnabled(req.adminUser, organizationId, dto?.enabled, dto?.reason, req.ip);
  }

  @Get("teaching")
  listTeaching() {
    return this.teaching.list();
  }

  @Post("teaching")
  createTeaching(@Req() req: any, @Body() dto: CreateTeachingDto) {
    return this.teaching.create(req.adminUser, dto, req.ip);
  }

  @Patch("teaching/:id")
  updateTeaching(@Req() req: any, @Param("id") id: string, @Body() dto: UpdateTeachingDto) {
    return this.teaching.update(req.adminUser, id, dto, req.ip);
  }

  @Patch("teaching/:id/enabled")
  setTeachingEnabled(@Req() req: any, @Param("id") id: string, @Body() dto: SetTeachingEnabledDto) {
    return this.teaching.setEnabled(req.adminUser, id, dto?.enabled, req.ip);
  }

  @Delete("teaching/:id")
  deleteTeaching(@Req() req: any, @Param("id") id: string) {
    return this.teaching.remove(req.adminUser, id, req.ip);
  }
}
