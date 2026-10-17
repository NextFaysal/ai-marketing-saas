import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { LiveCommerceService } from "./live-commerce.service";
import {
  CreateLiveSessionDto, CreateOrderFromCommentDto, ImportLiveCommentsDto, SetLiveSessionProductsDto,
} from "./live-commerce.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * NF1 (FB1) — Facebook Live Commerce staff surface. Follows the
 * PosController conventions exactly: @PermissionArea("orders")
 * (live selling is an order-taking surface; the "social" area
 * also exists but governs post publishing, not sales),
 * organizations/:organizationId base, TenantGuard + RolesGuard,
 * writes restricted to OWNER/ADMIN/MARKETING_MANAGER/
 * SUPPORT_AGENT. Reads stay staff reads for any role that can
 * see the orders area.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class LiveCommerceController {
  constructor(private readonly live: LiveCommerceService) {}

  @Post("live-sessions") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createSession(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateLiveSessionDto,
  ) {
    return this.live.createSession(orgId, user.userId, dto);
  }

  @Get("live-sessions")
  listSessions(@Param("organizationId") orgId: string) {
    return this.live.listSessions(orgId);
  }

  @Get("live-sessions/:id")
  getSession(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.live.getSession(orgId, id);
  }

  @Post("live-sessions/:id/start") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  startSession(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
  ) {
    return this.live.startSession(orgId, user.userId, id);
  }

  @Post("live-sessions/:id/end") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  endSession(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
  ) {
    return this.live.endSession(orgId, user.userId, id);
  }

  @Put("live-sessions/:id/products") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setProducts(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: SetLiveSessionProductsDto,
  ) {
    return this.live.setProducts(orgId, user.userId, id, dto.productIds ?? []);
  }

  @Post("live-sessions/:id/products/:productId/now-showing") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setNowShowing(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Param("productId") productId: string,
  ) {
    return this.live.setNowShowing(orgId, user.userId, id, productId);
  }

  @Get("live-sessions/:id/comments")
  listComments(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.live.listComments(orgId, id);
  }

  @Post("live-sessions/:id/comments") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  importComments(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: ImportLiveCommentsDto,
  ) {
    return this.live.importComments(orgId, user.userId, id, dto);
  }

  @Post("live-sessions/:id/comments/:commentId/order") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createOrderFromComment(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Body() dto: CreateOrderFromCommentDto,
  ) {
    return this.live.createOrderFromComment(orgId, user.userId, id, commentId, dto);
  }

  @Get("live-sessions/:id/recap")
  recap(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.live.recap(orgId, id);
  }

  @Post("live-sessions/:id/follow-up-segment") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  buildFollowUpSegment(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
  ) {
    return this.live.buildFollowUpSegment(orgId, user.userId, id);
  }
}
