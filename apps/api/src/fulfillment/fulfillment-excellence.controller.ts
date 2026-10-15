import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { FulfillmentExcellenceService } from "./fulfillment-excellence.service";
import { CreatePickWaveDto, RecordDeliveryAttemptDto, UpdateFulfillmentSettingsDto } from "./fulfillment.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * ON6 — Fulfillment Excellence routes (same org-prefixed shape
 * and guard pattern as FulfillmentController: writes behind
 * RolesGuard + WRITE_ROLES, reads for any staff role).
 * "pick-wave-suggestions" is a DISTINCT literal path, so it can
 * never collide with "pick-waves/:id".
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class FulfillmentExcellenceController {
  constructor(private readonly excellence: FulfillmentExcellenceService) {}

  // ---- SLA settings ----
  @Get("fulfillment-settings")
  getSettings(@Param("organizationId") orgId: string) { return this.excellence.getSettings(orgId); }

  @Put("fulfillment-settings") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateFulfillmentSettingsDto) {
    return this.excellence.updateSettings(orgId, user.userId, dto);
  }

  // ---- Pick waves ----
  @Post("pick-waves") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createWave(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePickWaveDto) {
    return this.excellence.createWave(orgId, user.userId, dto);
  }

  @Get("pick-waves")
  listWaves(@Param("organizationId") orgId: string) { return this.excellence.listWaves(orgId); }

  @Get("pick-wave-suggestions")
  suggestWaves(@Param("organizationId") orgId: string) { return this.excellence.suggestWaves(orgId); }

  @Get("pick-waves/:id")
  getWave(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.excellence.getWave(orgId, id);
  }

  @Post("pick-waves/:id/orders/:orderId/pick") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  pick(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Param("orderId") orderId: string) {
    return this.excellence.pickWaveOrder(orgId, user.userId, id, orderId);
  }

  @Post("pick-waves/:id/close") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  close(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.excellence.closeWave(orgId, user.userId, id);
  }

  @Delete("pick-waves/:id/orders/:orderId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  removeOrder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Param("orderId") orderId: string) {
    return this.excellence.removeWaveOrder(orgId, user.userId, id, orderId);
  }

  // ---- Delivery attempts ----
  @Post("orders/:orderId/delivery-attempts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  recordAttempt(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") orderId: string, @Body() dto: RecordDeliveryAttemptDto) {
    return this.excellence.recordDeliveryAttempt(orgId, user.userId, orderId, dto);
  }

  @Get("orders/:orderId/delivery-attempts")
  listAttempts(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.excellence.listDeliveryAttempts(orgId, orderId);
  }

  // ---- Escalations (staff list for the dispatch board) ----
  @Get("fulfillment-escalations")
  listEscalations(@Param("organizationId") orgId: string) { return this.excellence.listEscalations(orgId); }
}
