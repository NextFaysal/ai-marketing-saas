import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { DeliveryService } from "./delivery.service";
import { RiderGpsService } from "./rider-gps.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/** EC22 — Delivery Ops (own riders + assignments). */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly gps: RiderGpsService,
  ) {}

  @Get("delivery/riders")
  listRiders(@Param("organizationId") orgId: string) { return this.delivery.listRiders(orgId); }

  @Post("delivery/riders") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createRider(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: { name: string; phone: string }) {
    return this.delivery.createRider(orgId, user.userId, dto);
  }

  @Patch("delivery/riders/:riderId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateRider(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("riderId") riderId: string, @Body() dto: { name?: string; phone?: string; active?: boolean }) {
    return this.delivery.updateRider(orgId, user.userId, riderId, dto);
  }

  /** Delete = deactivate (soft); assignment history is kept. */
  @Delete("delivery/riders/:riderId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  removeRider(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("riderId") riderId: string) {
    return this.delivery.removeRider(orgId, user.userId, riderId);
  }

  @Post("delivery/assignments") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createAssignment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: { orderId: string; riderId: string; note?: string }) {
    return this.delivery.createAssignment(orgId, user.userId, dto);
  }

  @Post("delivery/assignments/:assignmentId/transition") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  transition(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("assignmentId") assignmentId: string, @Body() dto: { status: string }) {
    return this.delivery.transition(orgId, user.userId, assignmentId, dto);
  }

  // ---- NF9 (FB4): rider GPS — fleet view + share links ----

  @Get("delivery/fleet")
  fleet(@Param("organizationId") orgId: string) { return this.gps.fleet(orgId); }

  @Get("delivery/riders/:riderId/share-link")
  shareState(@Param("organizationId") orgId: string, @Param("riderId") riderId: string) {
    return this.gps.shareState(orgId, riderId);
  }

  /** Issue or rotate the rider's share link. The response is
   * the ONLY place the raw token ever appears. */
  @Post("delivery/riders/:riderId/share-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  issueShareLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("riderId") riderId: string) {
    return this.gps.issueShareLink(orgId, user.userId, riderId);
  }

  @Delete("delivery/riders/:riderId/share-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  revokeShareLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("riderId") riderId: string) {
    return this.gps.revokeShareLink(orgId, user.userId, riderId);
  }

  @Get("delivery/assignments")
  listAssignments(
    @Param("organizationId") orgId: string,
    @Query("riderId") riderId?: string,
    @Query("orderId") orderId?: string,
    @Query("date") date?: string,
  ) {
    return this.delivery.listAssignments(orgId, { riderId, orderId, date });
  }
}
