import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { SupplierPortalService } from "./supplier-portal.service";
import { PortalLeadTimeDto, PortalShipDto } from "./dropship.dto";
import { Public } from "../common/decorators";

/**
 * NF12 (FB4) — public supplier portal surface. No auth: the
 * portal token in the URL IS the credential (NF9/CX6 pattern),
 * resolved by SHA-256 hash in SupplierPortalService. The token
 * binds ONE supplier in ONE org — every handler below is
 * scoped by that pair inside the service, and there is no
 * route here that can reach orders, customers, other
 * suppliers, or any other org data.
 */
@Controller("public/supplier")
export class PublicSupplierPortalController {
  constructor(private readonly portal: SupplierPortalService) {}

  @Public()
  @Get(":token")
  resolve(@Param("token") token: string) {
    return this.portal.publicResolve(token);
  }

  @Public()
  @Post(":token/purchase-orders/:poId/confirm")
  confirm(@Param("token") token: string, @Param("poId") poId: string) {
    return this.portal.confirmPo(token, poId);
  }

  @Public()
  @Post(":token/purchase-orders/:poId/ship")
  ship(@Param("token") token: string, @Param("poId") poId: string, @Body() dto: PortalShipDto) {
    return this.portal.shipPo(token, poId, dto ?? {});
  }

  @Public()
  @Patch(":token/lead-time")
  leadTime(@Param("token") token: string, @Body() dto: PortalLeadTimeDto) {
    return this.portal.updateLeadTime(token, dto ?? {});
  }
}
