import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CourierService } from "./courier.service";
import { CourierRulesService } from "./courier-rules.service";
import { CourierNdrService } from "./courier-ndr.service";
import { CourierReconciliationService } from "./courier-reconciliation.service";
import { BookShipmentDto, BulkBookDto, ConnectCourierDto, QuoteCourierDto } from "./courier.dto";
import { RescheduleNdrDto, ResolveNdrDto, CustomerNdrActionDto } from "./courier-ndr.dto";
import { UploadDisbursementDto, UpdateDisputeDto } from "./courier-reconciliation.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("courier")
@Controller("organizations/:organizationId/courier")
@UseGuards(TenantGuard, RolesGuard)
export class CourierController {
  constructor(
    private readonly courier: CourierService,
    private readonly rules: CourierRulesService,
    private readonly ndr: CourierNdrService,
    private readonly reconciliation: CourierReconciliationService,
  ) {}

  @Get("connection")
  connection(@Param("organizationId") orgId: string, @Query("provider") provider?: string) {
    return this.courier.getConnection(orgId, provider);
  }

  @Get("connections")
  connections(@Param("organizationId") orgId: string) { return this.courier.getConnections(orgId); }

  // ---------- EC22: courier auto-selection rules ----------
  @Get("rules")
  listRules(@Param("organizationId") orgId: string) { return this.rules.list(orgId); }

  @Post("rules") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  createRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: {
    name: string; conditions: Record<string, unknown>; courierAccountId: string; priority?: number; active?: boolean;
  }) {
    return this.rules.create(orgId, user.userId, dto);
  }

  @Patch("rules/:ruleId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("ruleId") ruleId: string, @Body() dto: {
    name?: string; conditions?: Record<string, unknown>; courierAccountId?: string; priority?: number; active?: boolean;
  }) {
    return this.rules.update(orgId, user.userId, ruleId, dto);
  }

  @Delete("rules/:ruleId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("ruleId") ruleId: string) {
    return this.rules.remove(orgId, user.userId, ruleId);
  }

  /** EC22: which courier WOULD this order be auto-booked with? */
  @Get("suggestion/:orderId")
  suggestion(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.rules.suggestion(orgId, orderId);
  }

  /** EC22: set/clear a courier account's tracking URL template. */
  @Patch("tracking-template") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  setTrackingTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: {
    provider?: string; trackingUrlTemplate?: string | null;
  }) {
    return this.courier.setTrackingTemplate(orgId, user.userId, dto.provider, dto.trackingUrlTemplate);
  }

  @Post("connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectCourierDto) {
    return this.courier.connect(orgId, user.userId, dto);
  }

  // CC29: ?integrationId= disconnects exactly that account of
  // the provider; without it the primary account is disconnected
  // (the pre-CC29 behavior).
  @Delete("connection") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("provider") provider?: string, @Query("integrationId") integrationId?: string) {
    return this.courier.disconnect(orgId, user.userId, provider, integrationId);
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

  @Get("invoices.pdf")
  async invoicesPdf(@Param("organizationId") organizationId: string, @Query("ids") ids: string, @Res() res: Response) {
    this.sendPdf(res, await this.courier.invoicesPdf(organizationId, (ids ?? "").split(",").map((s) => s.trim()).filter(Boolean)), "invoices.pdf");
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

  /** Feature 1: NDR (Non-Delivery Report) Interceptor & Recovery Hub */
  @Get("ndr")
  listNdr(
    @Param("organizationId") orgId: string,
    @Query("status") status?: string,
    @Query("provider") provider?: string,
  ) {
    return this.ndr.list(orgId, { status, provider });
  }

  @Post("ndr/:id/contact")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  contactNdr(
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
  ) {
    return this.ndr.sendNdrCustomerAlert(orgId, { id, shipmentId: id });
  }

  @Post("ndr/:id/reschedule")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  rescheduleNdr(
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: RescheduleNdrDto,
  ) {
    return this.ndr.reschedule(orgId, id, dto);
  }

  @Post("ndr/:id/resolve")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  resolveNdr(
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: ResolveNdrDto,
  ) {
    return this.ndr.resolve(orgId, id, dto);
  }

  /** Feature 4: Courier COD Disbursement Reconciliation & Missing Cash Finder */
  @Post("reconciliation/upload")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "ACCOUNTANT")
  uploadDisbursement(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UploadDisbursementDto,
  ) {
    return this.reconciliation.processDisbursementBatch(orgId, dto, user?.userId);
  }

  @Get("reconciliation/batches")
  listBatches(@Param("organizationId") orgId: string) {
    return this.reconciliation.listBatches(orgId);
  }

  @Get("reconciliation/batches/:batchId")
  getBatchDetails(
    @Param("organizationId") orgId: string,
    @Param("batchId") batchId: string,
  ) {
    return this.reconciliation.getBatchDetails(orgId, batchId);
  }

  @Get("reconciliation/missing")
  getMissingDisbursements(
    @Param("organizationId") orgId: string,
    @Query("days") days?: string,
  ) {
    const parsedDays = days ? parseInt(days, 10) : 7;
    return this.reconciliation.getMissingDisbursements(orgId, isNaN(parsedDays) ? 7 : parsedDays);
  }

  @Post("reconciliation/items/:itemId/dispute")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "ACCOUNTANT", "SUPPORT_AGENT")
  updateDispute(
    @Param("organizationId") orgId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateDisputeDto,
  ) {
    return this.reconciliation.updateDispute(orgId, itemId, dto);
  }

  @Get("reconciliation/batches/:batchId/claim-sheet")
  getClaimSheet(
    @Param("organizationId") orgId: string,
    @Param("batchId") batchId: string,
  ) {
    return this.reconciliation.exportClaimSheet(orgId, batchId);
  }
}

/** CX6 + NDR: public live-tracking page data and customer self-serve response. */
@Controller("public/tracking")
export class PublicTrackingController {
  constructor(
    private readonly courier: CourierService,
    private readonly ndr: CourierNdrService,
  ) {}

  @Public()
  @Get(":token")
  view(@Param("token") token: string) { return this.courier.publicTracking(token); }

  @Public()
  @Post(":token/ndr-respond")
  respondNdr(@Param("token") token: string, @Body() dto: CustomerNdrActionDto) {
    return this.ndr.customerRespond(token, dto);
  }
}
