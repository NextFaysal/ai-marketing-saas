import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AttributionService } from "./attribution.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/decorators";
import { AttributionModelName } from "./engine";

const MODELS = ["FIRST_TOUCH", "LAST_TOUCH", "LAST_NON_DIRECT", "LINEAR"];

@Controller("organizations/:organizationId/attribution")
@UseGuards(TenantGuard)
export class AttributionController {
  constructor(private readonly attribution: AttributionService) {}

  @Get("report")
  report(@Param("organizationId") orgId: string, @Query("model") model?: string) {
    const m = MODELS.includes(model ?? "") ? (model as AttributionModelName) : "LAST_TOUCH";
    return this.attribution.report(orgId, m);
  }

  @Post("reconcile") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  reconcile(@Param("organizationId") orgId: string) { return this.attribution.reconcile(orgId); }

  @Get("settings")
  settings(@Param("organizationId") orgId: string) { return this.attribution.getSettings(orgId); }

  @Patch("settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSettings(@Param("organizationId") orgId: string, @Body() body: { windowDays: number }) {
    return this.attribution.updateSettings(orgId, Number(body?.windowDays));
  }

  @Get("orders/:orderId")
  credits(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.attribution.creditsForOrder(orgId, orderId);
  }
}
