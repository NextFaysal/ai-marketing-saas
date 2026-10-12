import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { PackingScanService } from "./packing-scan.service";
import { CompletePackingScanDto, ScanItemVerifyDto, StartPackingScanDto, VisionLabelScanDto } from "./packing-scan.dto";

@PermissionArea("orders")
@Controller("organizations/:organizationId/packing-scan")
@UseGuards(TenantGuard, RolesGuard)
export class PackingScanController {
  constructor(private readonly packingScan: PackingScanService) {}

  @Post("start")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async startScan(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: StartPackingScanDto,
  ) {
    return this.packingScan.startScan(orgId, user.userId, dto);
  }

  @Post(":scanId/verify")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async verifyItem(
    @Param("organizationId") orgId: string,
    @Param("scanId") scanId: string,
    @Body() dto: ScanItemVerifyDto,
  ) {
    return this.packingScan.verifyItem(orgId, scanId, dto);
  }

  @Post(":scanId/complete")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async completeScan(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
    @Param("scanId") scanId: string,
    @Body() dto: CompletePackingScanDto,
  ) {
    return this.packingScan.completeScan(orgId, user.userId, scanId, dto);
  }

  @Post("vision")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async scanLabelVision(
    @Param("organizationId") orgId: string,
    @Body() dto: VisionLabelScanDto,
  ) {
    return this.packingScan.scanLabelVision(orgId, dto);
  }

  @Get("history")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async getScanHistory(
    @Param("organizationId") orgId: string,
    @Query("orderId") orderId?: string,
  ) {
    return this.packingScan.getScanHistory(orgId, orderId);
  }
}

