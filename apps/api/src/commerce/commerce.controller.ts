import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CommerceService } from "./commerce.service";
import { OrderPushService } from "./order-push.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";
import { BundlesService } from "./bundles.service";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";
import { CommerceAnalyticsService } from "./commerce-analytics.service";
import { LoyaltyService } from "./loyalty.service";
import { GiftCardsService } from "./gift-cards.service";
import { LicenseKeysService } from "./license-keys.service";
import { PriceListsService } from "./price-lists.service";
import { QuotesService } from "./quotes.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import {
  AbandonedCouponSettingDto,
  BundleDto,
  LoyaltyAdjustDto,
  LoyaltySettingDto,
  ReferralRewardSettingDto,
  GiftCardAdjustDto,
  GiftCardNoteDto,
  GiftCardSettingDto,
  LicenseKeyImportDto,
  ManualGiftCardIssueDto,
  BulkPercentOffDto,
  CustomerGroupDto,
  PriceListItemDto,
  QuoteDto,
  UpdateCustomerGroupDto,
  UpdateQuoteDto,
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
    private readonly loyalty: LoyaltyService,
    private readonly giftCards: GiftCardsService,
    private readonly priceLists: PriceListsService,
    private readonly quotes: QuotesService,
    private readonly licenseKeys: LicenseKeysService,
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

  /** AB7 (AX19): order attribution stamps grouped by utmSource. */
  @Get("analytics/sources")
  sourceBreakdown(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.analytics.sourceBreakdown(orgId, days);
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
  listDiscounts(@Param("organizationId") orgId: string, @Query("origin") origin?: string) {
    return this.discounts.list(orgId, origin ? { origin } : undefined);
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

  @Get("promotions/report")
  promotionsReport(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.promotions.promotionsReport(orgId, from, to);
  }

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

  @Get("abandoned/coupon-setting")
  getAbandonedCouponSetting(@Param("organizationId") orgId: string) {
    return this.abandoned.getCouponSetting(orgId);
  }

  @Put("abandoned/coupon-setting")
  @Roles(...WRITE_ROLES)
  updateAbandonedCouponSetting(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: AbandonedCouponSettingDto,
  ) {
    return this.abandoned.updateCouponSetting(orgId, user.userId, dto);
  }

  // AX18: EC10 sequence state for one checkout — commerce-
  // prefixed aliases of the canonical route. The canonical
  // path the AX18 spec + the dashboard sequence view call is
  // organizations/:organizationId/abandoned-checkouts/:id/sequence,
  // which sits OUTSIDE this controller's commerce prefix, so it
  // is served by AbandonedSequenceController below (same
  // guards, same handler).
  @Get(["abandoned/:checkoutId/sequence", "abandoned-checkouts/:checkoutId/sequence"])
  getAbandonedSequence(
    @Param("organizationId") orgId: string,
    @Param("checkoutId") checkoutId: string,
  ) {
    return this.abandoned.getCheckoutSequence(orgId, checkoutId);
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
    @Query("discountText") discountText?: string,
  ) {
    return this.abandoned.getWhatsAppRecoveryData(orgId, checkoutId, discountCode, discountText);
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

  // ---------- AB1: loyalty points (AX1) + referral rewards (AX2) ----------

  @Get("loyalty/settings")
  getLoyaltySetting(@Param("organizationId") orgId: string) {
    return this.loyalty.getLoyaltySetting(orgId);
  }

  @Put("loyalty/settings")
  @Roles(...WRITE_ROLES)
  updateLoyaltySetting(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: LoyaltySettingDto,
  ) {
    return this.loyalty.updateLoyaltySetting(orgId, user.userId, dto);
  }

  @Get("loyalty/referral-settings")
  getReferralRewardSetting(@Param("organizationId") orgId: string) {
    return this.loyalty.getReferralRewardSetting(orgId);
  }

  @Put("loyalty/referral-settings")
  @Roles(...WRITE_ROLES)
  updateReferralRewardSetting(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: ReferralRewardSettingDto,
  ) {
    return this.loyalty.updateReferralRewardSetting(orgId, user.userId, dto);
  }

  @Get("loyalty/customers/:customerId")
  getCustomerLoyalty(
    @Param("organizationId") orgId: string,
    @Param("customerId") customerId: string,
  ) {
    return this.loyalty.getCustomerLoyalty(orgId, customerId);
  }

  @Post("loyalty/customers/:customerId/adjust")
  @Roles(...WRITE_ROLES)
  adjustCustomerLoyalty(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("customerId") customerId: string,
    @Body() dto: LoyaltyAdjustDto,
  ) {
    return this.loyalty.adjustPoints(orgId, user.userId, customerId, dto);
  }

  @Get("loyalty/orders/:orderId")
  getOrderLoyalty(
    @Param("organizationId") orgId: string,
    @Param("orderId") orderId: string,
  ) {
    return this.loyalty.getOrderLoyalty(orgId, orderId);
  }

  // ---------- AB2: gift cards (AX3) ----------

  @Get("gift-cards/settings")
  getGiftCardSetting(@Param("organizationId") orgId: string) {
    return this.giftCards.getSetting(orgId);
  }

  @Put("gift-cards/settings")
  @Roles(...WRITE_ROLES)
  updateGiftCardSetting(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: GiftCardSettingDto,
  ) {
    return this.giftCards.updateSetting(orgId, user.userId, dto);
  }

  @Get("gift-cards/liability")
  giftCardLiability(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.giftCards.liabilityReport(orgId, from, to);
  }

  @Get("gift-cards")
  listGiftCards(
    @Param("organizationId") orgId: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.giftCards.listCards(orgId, {
      search: search || undefined,
      status: status || undefined,
      page: parseIntDef(page, 1),
      pageSize: parseIntDef(pageSize, 20),
    });
  }

  @Post("gift-cards/issue")
  @Roles(...WRITE_ROLES)
  manualIssueGiftCard(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: ManualGiftCardIssueDto,
  ) {
    return this.giftCards.manualIssue(orgId, user.userId, dto);
  }

  @Get("gift-cards/:id")
  getGiftCard(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.giftCards.getCard(orgId, id);
  }

  @Post("gift-cards/:id/void")
  @Roles(...WRITE_ROLES)
  voidGiftCard(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: GiftCardNoteDto,
  ) {
    return this.giftCards.voidCard(orgId, user.userId, id, dto);
  }

  @Post("gift-cards/:id/adjust")
  @Roles(...WRITE_ROLES)
  adjustGiftCard(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: GiftCardAdjustDto,
  ) {
    return this.giftCards.adjustBalance(orgId, user.userId, id, dto);
  }

  // ---------- AB5 (AX9): license-key pools ----------

  @Post("license-keys/import")
  @Roles(...WRITE_ROLES)
  importLicenseKeys(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: LicenseKeyImportDto,
  ) {
    return this.licenseKeys.importKeys(orgId, user.userId, dto.productId, dto);
  }

  @Get("license-keys/pool-summary")
  poolSummary(
    @Param("organizationId") orgId: string,
    @Query("productId") productId?: string,
  ) {
    return this.licenseKeys.poolSummary(orgId, productId ?? "");
  }

  @Get("license-keys")
  listLicenseKeys(
    @Param("organizationId") orgId: string,
    @Query("productId") productId?: string,
    @Query("status") status?: string,
    @Query("take") take?: string,
  ) {
    return this.licenseKeys.listKeys(orgId, {
      productId: productId || undefined,
      status: status || undefined,
      take: take ? parseIntDef(take, 100) : undefined,
    });
  }

  @Post("license-keys/:keyId/revoke")
  @Roles(...WRITE_ROLES)
  revokeLicenseKey(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("keyId") keyId: string,
  ) {
    return this.licenseKeys.revokeKey(orgId, user.userId, keyId);
  }

  // ---------- AB5 (AX7): B2B customer groups + price lists ----------

  @Get("customer-groups")
  listCustomerGroups(@Param("organizationId") orgId: string) {
    return this.priceLists.listGroups(orgId);
  }

  @Post("customer-groups")
  @Roles(...WRITE_ROLES)
  createCustomerGroup(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CustomerGroupDto,
  ) {
    return this.priceLists.createGroup(orgId, user.userId, dto);
  }

  @Patch("customer-groups/:groupId")
  @Roles(...WRITE_ROLES)
  updateCustomerGroup(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("groupId") groupId: string,
    @Body() dto: UpdateCustomerGroupDto,
  ) {
    return this.priceLists.updateGroup(orgId, user.userId, groupId, dto);
  }

  @Delete("customer-groups/:groupId")
  @Roles(...WRITE_ROLES)
  deleteCustomerGroup(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("groupId") groupId: string,
  ) {
    return this.priceLists.deleteGroup(orgId, user.userId, groupId);
  }

  @Get("customer-groups/:groupId/price-list")
  getPriceList(@Param("organizationId") orgId: string, @Param("groupId") groupId: string) {
    return this.priceLists.getPriceList(orgId, groupId);
  }

  @Post("customer-groups/:groupId/price-list/items")
  @Roles(...WRITE_ROLES)
  setPriceListItem(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("groupId") groupId: string,
    @Body() dto: PriceListItemDto,
  ) {
    return this.priceLists.setItem(orgId, user.userId, groupId, dto);
  }

  @Delete("customer-groups/:groupId/price-list/items/:itemId")
  @Roles(...WRITE_ROLES)
  removePriceListItem(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("groupId") groupId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.priceLists.removeItem(orgId, user.userId, groupId, itemId);
  }

  @Post("customer-groups/:groupId/price-list/bulk-percent")
  @Roles(...WRITE_ROLES)
  bulkPercentOff(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("groupId") groupId: string,
    @Body() dto: BulkPercentOffDto,
  ) {
    return this.priceLists.bulkPercentOff(orgId, user.userId, groupId, dto);
  }

  // ---------- AB5 (AX7): quotes ----------
  // NOTE: conversion is NOT here — it creates a real order via
  // OrdersService.createManual, and OrdersModule imports this
  // module (never the reverse), so the convert route lives on
  // the orders side: POST organizations/:id/orders/from-quote/:quoteId/convert.
  // The read-only preview (manual-path math, creates nothing)
  // lives here with the rest of the quote surface.

  @Get("quotes")
  listQuotes(
    @Param("organizationId") orgId: string,
    @Query("status") status?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.quotes.listQuotes(orgId, {
      status: status || undefined,
      customerId: customerId || undefined,
    });
  }

  @Post("quotes")
  @Roles(...WRITE_ROLES)
  createQuote(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: QuoteDto,
  ) {
    return this.quotes.createQuote(orgId, user.userId, dto);
  }

  @Get("quotes/:quoteId")
  getQuote(@Param("organizationId") orgId: string, @Param("quoteId") quoteId: string) {
    return this.quotes.getQuote(orgId, quoteId);
  }

  @Patch("quotes/:quoteId")
  @Roles(...WRITE_ROLES)
  updateQuote(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("quoteId") quoteId: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotes.updateQuote(orgId, user.userId, quoteId, dto);
  }

  @Post("quotes/:quoteId/cancel")
  @Roles(...WRITE_ROLES)
  cancelQuote(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("quoteId") quoteId: string,
  ) {
    return this.quotes.cancelQuote(orgId, user.userId, quoteId);
  }

  @Post("quotes/:quoteId/send")
  @Roles(...WRITE_ROLES)
  sendQuote(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("quoteId") quoteId: string,
  ) {
    return this.quotes.sendQuote(orgId, user.userId, quoteId);
  }

  @Get("quotes/:quoteId/convert-preview")
  previewQuoteConversion(
    @Param("organizationId") orgId: string,
    @Param("quoteId") quoteId: string,
  ) {
    return this.quotes.previewConversion(orgId, quoteId);
  }
}

/**
 * AX18: canonical EC10 sequence-state route —
 * GET organizations/:organizationId/abandoned-checkouts/:checkoutId/sequence.
 * This is the exact path the AX18 spec names and the dashboard
 * abandoned page calls (apiFetch without the commerce segment).
 * It lives in its own controller class only because
 * CommerceController's class prefix is
 * "organizations/:organizationId/commerce"; guards and the
 * backing service are identical to the sibling abandoned
 * routes, and a foreign/unknown checkout 404s inside
 * AbandonedCheckoutsService.getCheckoutSequence.
 */
@PermissionArea("integrations")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class AbandonedSequenceController {
  constructor(private readonly abandoned: AbandonedCheckoutsService) {}

  @Get("abandoned-checkouts/:checkoutId/sequence")
  getAbandonedSequence(
    @Param("organizationId") orgId: string,
    @Param("checkoutId") checkoutId: string,
  ) {
    return this.abandoned.getCheckoutSequence(orgId, checkoutId);
  }
}
