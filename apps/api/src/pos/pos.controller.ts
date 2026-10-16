import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PosService } from "./pos.service";
import { PosOfflineService } from "./pos-offline.service";
import {
  CreatePosSaleDto, DiscardOfflineSyncDto, OfflineSyncDto, RepostOfflineSyncDto,
} from "./pos.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * EC34 — POS / কাউন্টার বিক্রি staff surface. Search + today's
 * sales are staff reads (any role that can see the orders area);
 * completing a sale is a WRITE role action.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly offline: PosOfflineService,
  ) {}

  @Get("pos/search")
  search(@Param("organizationId") orgId: string, @Query("q") q?: string) {
    return this.pos.search(orgId, q);
  }

  @Get("pos/today")
  today(@Param("organizationId") orgId: string) {
    return this.pos.today(orgId);
  }

  @Post("pos/sale") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createSale(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreatePosSaleDto,
  ) {
    return this.pos.createSale(orgId, user.userId, dto);
  }

  // AB4 (AX6) — offline sync ledger. Sync/repost/discard are
  // WRITE role actions; the ledger list is a staff read like
  // search/today.
  @Post("pos/offline-sync") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncOffline(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: OfflineSyncDto,
  ) {
    return this.offline.sync(orgId, user.userId, dto);
  }

  @Get("pos/offline-sync")
  listOffline(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.offline.list(orgId, status);
  }

  @Post("pos/offline-sync/:syncId/repost") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  repostOffline(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("syncId") syncId: string,
    @Body() dto: RepostOfflineSyncDto,
  ) {
    return this.offline.repost(orgId, user.userId, syncId, dto ?? {});
  }

  @Post("pos/offline-sync/:syncId/discard") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  discardOffline(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("syncId") syncId: string,
    @Body() dto: DiscardOfflineSyncDto,
  ) {
    return this.offline.discard(orgId, user.userId, syncId, dto ?? {});
  }
}
