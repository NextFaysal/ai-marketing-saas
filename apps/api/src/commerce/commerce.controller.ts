import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CommerceService } from "./commerce.service";
import { OrderPushService } from "./order-push.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";
import { BundlesService } from "./bundles.service";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";
import { CommerceAnalyticsService } from "./commerce-analytics.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import {
  BundleDto,
  ChannelPriceDto,
  CreateLocationDto,
  DiscountDto,
  GenerateCampaignDto,
  PromotionDto,
  PromotionPreviewDto,
  ResolveConflictDto,
  SaleScheduleDto,
  SetDiscountActiveDto,
  SetPromotionActiveDto,
  UpdateLocationDto,
  UpdateRefundPushDto,
  UpdateSyncModeDto,
  UpdateTrackingMetaKeyDto,
} from "./commerce.dto";

function parseIntDef(v: unknown, def: number): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

@PermissionArea("integrations")
@Controller("organizations/:organizationId/commerce")
@UseGuards(TenantGuard, RolesGuard)
export class CommerceController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly outbox: SyncOutboxService,
    private readonly orderPush: OrderPushService,
    private readonly discounts: DiscountsService,
    private readonly promotions: PromotionsService,
    private readonly abandoned: AbandonedCheckoutsService,
    private readonly analytics: CommerceAnalyticsService,
    private readonly bundles: BundlesService,
  ) {}

  // ---------- EC11: per-store analytics + Commerce Hub ----------

  @Get("analytics/stores")
  storesAnalytics(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.analytics.storesAnalytics(orgId, days);
  }

  @Get("analytics/dead-stock")
  deadStock(
    @Param("organizationId") orgId: string,
    @Query("days") days?: string,
    @Query("limit") limit?: string,
  ) {
    return this.analytics.deadStock(orgId, days, limit);
  }

  @Get("analytics/top-products")
  topProducts(
    @Param("organizationId") orgId: string,
    @Query("storeId") storeId?: string,
    @Query("days") days?: string,
    @Query("limit") limit?: string,
  ) {
    return this.analytics.topProducts(orgId, {
      storeId: storeId || undefined,
      days,
      limit,
    });
  }

  @Get("hub-summary")
  hubSummary(@Param("organizationId") orgId: string) {
    return this.analytics.hubSummary(orgId);
  }

  @Get("outbox")
  listOutbox(
    @Param("organizationId") orgId: string,
    @Query("storeId") storeId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.outbox.list(orgId, {
      storeId: storeId || undefined,
      status: status || undefined,
      page: parseIntDef(page, 1),
      pageSize: parseIntDef(pageSize, 20),
    });
  }

  @Get("listings")
  listings(
    @Param("organizationId") orgId: string,
    @Query("storeId") storeId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.commerce.listingsSummaryAndList(orgId, {
      storeId: storeId || undefined,
      status: status || undefined,
      page: parseIntDef(page, 1),
      pageSize: parseIntDef(pageSize, 20),
    });
  }

  @Get("conflicts")
  conflicts(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.commerce.listConflicts(orgId, { status: status || undefined });
  }

  @Post("conflicts/:conflictId/resolve")
  @Roles(...WRITE_ROLES)
  resolveConflict(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("conflictId") conflictId: string,
    @Body() dto: ResolveConflictDto,
  ) {
    return this.commerce.resolveConflict(orgId, user.userId, conflictId, dto.choice, dto.choices);
  }

  @Post("listings/:listingId/publish")
  @Roles(...WRITE_ROLES)
  publishListing(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("listingId") listingId: string,
  ) {
    return this.commerce.publishListing(orgId, user.userId, listingId);
  }

  @Post("listings/:listingId/unpublish")
  @Roles(...WRITE_ROLES)
  unpublishListing(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("listingId") listingId: string,
  ) {
    return this.commerce.unpublishListing(orgId, user.userId, listingId);
  }

  @Patch("listings/:listingId/channel-price")
  @Roles(...WRITE_ROLES)
  updateChannelPrice(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("listingId") listingId: string,
    @Body() dto: ChannelPriceDto,
  ) {
    return this.commerce.updateChannelPrice(orgId, user.userId, listingId, dto);
  }

  @Patch("listings/:listingId/sale-schedule")
  @Roles(...WRITE_ROLES)
  updateSaleSchedule(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("listingId") listingId: string,
    @Body() dto: SaleScheduleDto,
  ) {
    return this.commerce.updateSaleSchedule(orgId, user.userId, listingId, dto);
  }

  @Delete("listings/:listingId/remote")
  @Roles("OWNER")
  deleteListingRemote(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("listingId") listingId: string,
  ) {
    return this.commerce.deleteListingRemote(orgId, user.userId, listingId);
  }

  @Get("stores/:storeId/locations")
  listLocations(@Param("organizationId") orgId: string, @Param("storeId") storeId: string) {
    return this.commerce.listLocations(orgId, storeId);
  }

  @Post("stores/:storeId/locations")
  @Roles(...WRITE_ROLES)
  createLocation(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("storeId") storeId: string,
    @Body() dto: CreateLocationDto,
  ) {
    return this.commerce.createLocation(orgId, user.userId, storeId, dto);
  }

  @Post("stores/:storeId/locations/refresh")
  @Roles(...WRITE_ROLES)
  refreshLocations(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.commerce.refreshLocations(orgId, user.userId, storeId);
  }

  @Patch("locations/:locationId")
  @Roles(...WRITE_ROLES)
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("locationId") locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.commerce.updateLocation(orgId, user.userId, locationId, dto);
  }

  @Delete("locations/:locationId")
  @Roles("OWNER", "ADMIN")
  deleteLocation(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("locationId") locationId: string,
  ) {
    return this.commerce.deleteLocation(orgId, user.userId, locationId);
  }

  @Post("outbox/:outboxId/replay")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  replay(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("outboxId") outboxId: string,
  ) {
    return this.commerce.replayOutbox(orgId, user.userId, outboxId);
  }

  /** EC5: what the orders UI's store-sync panel renders. */
  @Get("orders/:orderId/push-state")
  orderPushState(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.orderPush.pushState(orgId, orderId);
  }

  /** EC5 (plan §৯): refund-push gate — OWNER only, audit-logged. */
  @Patch("stores/:storeId/refund-push")
  @Roles("OWNER")
  updateRefundPush(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("storeId") storeId: string,
    @Body() dto: UpdateRefundPushDto,
  ) {
    return this.commerce.updateRefundPush(orgId, user.userId, storeId, dto.enabled === true);
  }

  @Patch("stores/:storeId/tracking-meta-key")
  @Roles(...WRITE_ROLES)
  updateTrackingMetaKey(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("storeId") storeId: string,
    @Body() dto: UpdateTrackingMetaKeyDto,
  ) {
    return this.commerce.updateTrackingMetaKey(orgId, user.userId, storeId, dto.courierTrackingMetaKey ?? null);
  }

  @Patch("stores/:storeId/sync-mode")
  @Roles("OWNER", "ADMIN")
  updateSyncMode(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("storeId") storeId: string,
    @Body() dto: UpdateSyncModeDto,
  ) {
    return this.commerce.updateSyncMode(orgId, user.userId, storeId, dto);
  }

  // ---------- EC7: discounts & promotions ----------

  @Get("discounts")
  listDiscounts(@Param("organizationId") orgId: string) {
    return this.discounts.list(orgId);
  }

  @Get("discounts/:discountId")
  getDiscount(@Param("organizationId") orgId: string, @Param("discountId") discountId: string) {
    return this.discounts.getOne(orgId, discountId);
  }

  @Post("discounts")
  @Roles(...WRITE_ROLES)
  createDiscount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: DiscountDto) {
    return this.discounts.create(orgId, user.userId, dto);
  }

  @Patch("discounts/:discountId")
  @Roles(...WRITE_ROLES)
  updateDiscount(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("discountId") discountId: string,
    @Body() dto: DiscountDto,
  ) {
    return this.discounts.update(orgId, user.userId, discountId, dto);
  }

  @Post("discounts/:discountId/active")
  @Roles(...WRITE_ROLES)
  setDiscountActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("discountId") discountId: string,
    @Body() dto: SetDiscountActiveDto,
  ) {
    return this.discounts.setActive(orgId, user.userId, discountId, dto.active === true);
  }

  @Post("discounts/generate-campaign")
  @Roles(...WRITE_ROLES)
  generateCampaign(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateCampaignDto) {
    return this.discounts.generateCampaignCodes(orgId, user.userId, dto);
  }

  @Post("discounts/pull/:storeId")
  @Roles(...WRITE_ROLES)
  pullDiscounts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("storeId") storeId: string) {
    return this.discounts.pullFromStore(orgId, user.userId, storeId);
  }

  // ---------- EC16: promotions v2 ----------

  @Get("promotions")
  listPromotions(@Param("organizationId") orgId: string) {
    return this.promotions.list(orgId);
  }

  @Get("promotions/:promotionId")
  getPromotion(@Param("organizationId") orgId: string, @Param("promotionId") promotionId: string) {
    return this.promotions.getOne(orgId, promotionId);
  }

  @Post("promotions")
  @Roles(...WRITE_ROLES)
  createPromotion(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PromotionDto) {
    return this.promotions.create(orgId, user.userId, dto);
  }

  @Patch("promotions/:promotionId")
  @Roles(...WRITE_ROLES)
  updatePromotion(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("promotionId") promotionId: string,
    @Body() dto: PromotionDto,
  ) {
    return this.promotions.update(orgId, user.userId, promotionId, dto);
  }

  @Post("promotions/:promotionId/active")
  @Roles(...WRITE_ROLES)
  setPromotionActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("promotionId") promotionId: string,
    @Body() dto: SetPromotionActiveDto,
  ) {
    return this.promotions.setActive(orgId, user.userId, promotionId, dto.active === true);
  }

  @Delete("promotions/:promotionId")
  @Roles(...WRITE_ROLES)
  deletePromotion(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("promotionId") promotionId: string,
  ) {
    return this.promotions.remove(orgId, user.userId, promotionId);
  }

  @Post("promotions/preview")
  previewPromotion(@Param("organizationId") orgId: string, @Body() dto: PromotionPreviewDto) {
    return this.promotions.preview(orgId, dto);
  }

  // ---------- EC29: bundles ----------

  @Get("bundles")
  listBundles(@Param("organizationId") orgId: string) {
    return this.bundles.list(orgId);
  }

  @Get("bundles/:bundleId")
  getBundle(@Param("organizationId") orgId: string, @Param("bundleId") bundleId: string) {
    return this.bundles.getOne(orgId, bundleId);
  }

  @Post("bundles")
  @Roles(...WRITE_ROLES)
  createBundle(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BundleDto) {
    return this.bundles.create(orgId, user.userId, dto);
  }

  @Patch("bundles/:bundleId")
  @Roles(...WRITE_ROLES)
  updateBundle(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("bundleId") bundleId: string,
    @Body() dto: BundleDto,
  ) {
    return this.bundles.update(orgId, user.userId, bundleId, dto);
  }

  @Post("bundles/:bundleId/active")
  @Roles(...WRITE_ROLES)
  setBundleActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("bundleId") bundleId: string,
    @Body() dto: SetPromotionActiveDto,
  ) {
    return this.bundles.setActive(orgId, user.userId, bundleId, dto.active === true);
  }

  @Delete("bundles/:bundleId")
  @Roles(...WRITE_ROLES)
  deleteBundle(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("bundleId") bundleId: string,
  ) {
    return this.bundles.remove(orgId, user.userId, bundleId);
  }

  // ---------- EC10: unified abandoned carts / store checkouts ----------

  @Get("abandoned")
  listAbandoned(@Param("organizationId") orgId: string) {
    return this.abandoned.listUnified(orgId);
  }

  @Post("abandoned/:checkoutId/recover")
  @Roles(...WRITE_ROLES)
  recoverAbandoned(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("checkoutId") checkoutId: string,
  ) {
    // EC8: the id may be a store checkout (EC10) or a native cart —
    // the service dispatches to the right recovery path.
    return this.abandoned.sendRecovery(orgId, user.userId, checkoutId);
  }

  @Get("abandoned/:checkoutId/whatsapp")
  getAbandonedWhatsApp(
    @Param("organizationId") orgId: string,
    @Param("checkoutId") checkoutId: string,
    @Query("discountCode") discountCode?: string,
  ) {
    return this.abandoned.getWhatsAppRecoveryData(orgId, checkoutId, discountCode);
  }

  @Post("abandoned/backfill/:storeId")
  @Roles(...WRITE_ROLES)
  backfillAbandoned(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.abandoned.backfillFromShopify(orgId, user.userId, storeId);
  }
}
