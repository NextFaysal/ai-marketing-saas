import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/decorators";
import { CurrentOrg, CurrentUser } from "../common/decorators";
import { PackingScanService } from "./packing-scan.service";
import { CompletePackingScanDto, ScanItemVerifyDto, StartPackingScanDto, VisionLabelScanDto } from "./packing-scan.dto";

@Controller("packing-scan")
@UseGuards(AuthGuard, RolesGuard)
export class PackingScanController {
  constructor(private readonly packingScan: PackingScanService) {}

  @Post("start")
  @Roles("owner", "admin", "agent")
  async startScan(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: StartPackingScanDto,
  ) {
    return this.packingScan.startScan(orgId, user.id, dto);
  }

  @Post(":scanId/verify")
  @Roles("owner", "admin", "agent")
  async verifyItem(
    @CurrentOrg() orgId: string,
    @Param("scanId") scanId: string,
    @Body() dto: ScanItemVerifyDto,
  ) {
    return this.packingScan.verifyItem(orgId, scanId, dto);
  }

  @Post(":scanId/complete")
  @Roles("owner", "admin", "agent")
  async completeScan(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: { id: string },
    @Param("scanId") scanId: string,
    @Body() dto: CompletePackingScanDto,
  ) {
    return this.packingScan.completeScan(orgId, user.id, scanId, dto);
  }

  @Post("vision")
  @Roles("owner", "admin", "agent")
  async scanLabelVision(
    @CurrentOrg() orgId: string,
    @Body() dto: VisionLabelScanDto,
  ) {
    return this.packingScan.scanLabelVision(orgId, dto);
  }

  @Get("history")
  @Roles("owner", "admin", "agent")
  async getScanHistory(
    @CurrentOrg() orgId: string,
    @Query("orderId") orderId?: string,
  ) {
    return this.packingScan.getScanHistory(orgId, orderId);
  }
}
