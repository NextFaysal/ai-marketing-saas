import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CourierService } from "./courier.service";
import { BookShipmentDto, BulkBookDto, ConnectCourierDto, QuoteCourierDto } from "./courier.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("courier")
@Controller("organizations/:organizationId/courier")
@UseGuards(TenantGuard, RolesGuard)
export class CourierController {
  constructor(private readonly courier: CourierService) {}

  @Get("connection")
  connection(@Param("organizationId") orgId: string, @Query("provider") provider?: string) {
    return this.courier.getConnection(orgId, provider);
  }

  @Get("connections")
  connections(@Param("organizationId") orgId: string) { return this.courier.getConnections(orgId); }

  @Post("connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectCourierDto) {
    return this.courier.connect(orgId, user.userId, dto);
  }

  @Delete("connection") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("provider") provider?: string) {
    return this.courier.disconnect(orgId, user.userId, provider);
  }

  @Get("pathao/stores")
  pathaoStores(@Param("organizationId") orgId: string) { return this.courier.pathaoStores(orgId); }
  @Get("pathao/cities")
  pathaoCities(@Param("organizationId") orgId: string) { return this.courier.pathaoCities(orgId); }
  @Get("pathao/zones/:cityId")
  pathaoZones(@Param("organizationId") orgId: string, @Param("cityId") cityId: string) {
    return this.courier.pathaoZones(orgId, Number(cityId));
  }
  @Get("pathao/areas/:zoneId")
  pathaoAreas(@Param("organizationId") orgId: string, @Param("zoneId") zoneId: string) {
    return this.courier.pathaoAreas(orgId, Number(zoneId));
  }
  @Get("redx/areas")
  redxAreas(@Param("organizationId") orgId: string) { return this.courier.redxAreas(orgId); }
  @Get("redx/stores")
  redxStores(@Param("organizationId") orgId: string) { return this.courier.redxStores(orgId); }

  /** Sales & Data S5: per-provider performance over booked shipments. */
  @Get("performance")
  performance(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.courier.performance(orgId, days);
  }

  @Get("shipments")
  list(@Param("organizationId") orgId: string, @Query("orderId") orderId?: string) {
    return this.courier.listShipments(orgId, orderId);
  }

  /** Milestone 52: pre-booking delivery-charge quote (provider's own pricing API). */
  @Post("quote") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  quote(@Param("organizationId") orgId: string, @Body() dto: QuoteCourierDto) {
    return this.courier.quote(orgId, dto);
  }

  @Post("shipments") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  book(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BookShipmentDto) {
    return this.courier.bookShipment(orgId, user.userId, dto);
  }

  /** Milestone 53: bulk booking (max 50) through the single-booking path. */
  @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  @Post("shipments/bulk")
  bookBulk(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkBookDto) {
    return this.courier.bookBulk(orgId, user.userId, dto);
  }

  /** Milestone 53: PDF downloads are binary responses. */
  private sendPdf(@Res() res: Response, buf: Buffer, filename: string) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  }

  @Get("shipments/:shipmentId/label.pdf")
  async labelPdf(@Param("organizationId") organizationId: string, @Param("shipmentId") shipmentId: string, @Res() res: Response) {
    this.sendPdf(res, await this.courier.labelPdf(organizationId, shipmentId), `label-${shipmentId}.pdf`);
  }

  @Get("labels.pdf")
  async labelsPdf(@Param("organizationId") organizationId: string, @Query("ids") ids: string, @Res() res: Response) {
    this.sendPdf(res, await this.courier.labelsPdf(organizationId, (ids ?? "").split(",").map((s) => s.trim())), "labels.pdf");
  }

  @Get("orders/:orderId/invoice.pdf")
  async invoicePdf(@Param("organizationId") organizationId: string, @Param("orderId") orderId: string, @Res() res: Response) {
    this.sendPdf(res, await this.courier.invoicePdf(organizationId, orderId), `invoice-${orderId}.pdf`);
  }

  @Post("shipments/:shipmentId/sync") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sync(@Param("organizationId") orgId: string, @Param("shipmentId") id: string) {
    return this.courier.syncShipment(orgId, id);
  }

  @Post("sync-all") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  syncAll(@Param("organizationId") orgId: string) { return this.courier.syncAll(orgId); }

  /** CX6: mint/return the shipment's public live-tracking link. */
  @Post("shipments/:shipmentId/tracking-link") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  trackingLink(@Param("organizationId") orgId: string, @Param("shipmentId") id: string) {
    return this.courier.trackingLinkForShipment(orgId, id);
  }
}

/** CX6: public live-tracking page data — no auth; the unguessable
 * token on the shipment row is the only credential (ReportShare
 * pattern). Serves stored facts only; never recipient PII. */
@Controller("public/tracking")
export class PublicTrackingController {
  constructor(private readonly courier: CourierService) {}

  @Public()
  @Get(":token")
  view(@Param("token") token: string) { return this.courier.publicTracking(token); }
}
