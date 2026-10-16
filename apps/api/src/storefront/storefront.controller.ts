import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { DeliveryPricingService } from "./delivery-pricing.service";
import { ShopAccountService } from "./shop-account.service";
import { RetentionService } from "./retention.service";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { RateLimit } from "../common/throttler.guard";
import {
  AddWishlistDto,
  AnswerProductQuestionDto,
  AskProductQuestionDto,
  CART_TOKEN_HEADER,
  CreateCustomerReturnDto,
  QuestionVisibilityDto,
  StockAlertSubscribeDto,
  CartContactDto,
  CheckoutDto,
  CreateAddressDto,
  CreateDeliverySlotDto,
  CreatePickupPointDto,
  CreateShippingRateRuleDto,
  CreateZoneDto,
  MergeWishlistDto,
  PatchCartBundleDto,
  PatchCartLineDto,
  QuoteDto,
  RequestOtpDto,
  SHOP_SESSION_HEADER,
  TrackLookupDto,
  NdrRecoveryDto,
  UpdateAddressDto,
  UpdateDeliverySlotDto,
  UpdatePickupPointDto,
  UpdateProfileDto,
  UpdateShippingRateRuleDto,
  UpdateStorefrontSettingsDto,
  UpdateZoneDto,
  VerifyOtpDto,
} from "./storefront.dto";

function parseIntDef(v: unknown, def: number): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/**
 * EC8 public storefront API. All routes are @Public (guest shoppers
 * have no account); the shop answers 404 unless the org's
 * StorefrontSetting has shopEnabled = true. The guest cart is
 * addressed by the `x-cart-token` header issued at cart creation.
 *
 * Route order matters: `by-domain/:domain` is declared BEFORE
 * `:orgSlug` so "by-domain" is never captured as an org slug.
 */
@Controller("public/shop")
export class PublicShopController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly shopAccount: ShopAccountService,
    private readonly retention: RetentionService,
  ) {}

  @Public()
  @Get("by-domain/:domain")
  byDomain(@Param("domain") domain: string) {
    return this.storefront.byDomain(domain);
  }

  @Public()
  @Get(":orgSlug")
  home(
    @Param("orgSlug") orgSlug: string,
    @Query("q") q?: string,
    @Query("category") category?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.storefront.shopHome(orgSlug, {
      q: q || undefined,
      category: category || undefined,
      page: parseIntDef(page, 1),
      pageSize: parseIntDef(pageSize, 24),
    });
  }

  @Public()
  @Get(":orgSlug/products/:productSlug")
  product(@Param("orgSlug") orgSlug: string, @Param("productSlug") productSlug: string) {
    return this.storefront.productDetail(orgSlug, productSlug);
  }

  /** EC30: active pickup points for the checkout picker. */
  @Public()
  @Get(":orgSlug/pickup-points")
  pickupPoints(@Param("orgSlug") orgSlug: string) {
    return this.storefront.listPublicPickupPoints(orgSlug);
  }

  @Public()
  @Post(":orgSlug/cart")
  createCart(@Param("orgSlug") orgSlug: string) {
    return this.storefront.createCart(orgSlug);
  }

  @Public()
  @Get(":orgSlug/cart")
  getCart(@Param("orgSlug") orgSlug: string, @Headers(CART_TOKEN_HEADER) token?: string) {
    return this.storefront.getCart(orgSlug, token);
  }

  /** PATCH one line: { productId, variantId?, quantity, includeBump? } — quantity 0 removes. */
  @Public()
  @Patch(":orgSlug/cart")
  patchCart(
    @Param("orgSlug") orgSlug: string,
    @Headers(CART_TOKEN_HEADER) token: string | undefined,
    @Body() dto: PatchCartLineDto,
  ) {
    return this.storefront.patchCartLine(orgSlug, token, dto);
  }

  /** EC29: set one bundle line: { bundleId, quantity } — quantity 0 removes. */
  @Public()
  @Post(":orgSlug/cart/bundle")
  patchCartBundle(
    @Param("orgSlug") orgSlug: string,
    @Headers(CART_TOKEN_HEADER) token: string | undefined,
    @Body() dto: PatchCartBundleDto,
  ) {
    return this.storefront.patchCartBundle(orgSlug, token, dto);
  }

  @Public()
  @Post(":orgSlug/cart/contact")
  cartContact(
    @Param("orgSlug") orgSlug: string,
    @Headers(CART_TOKEN_HEADER) token: string | undefined,
    @Body() dto: CartContactDto,
  ) {
    return this.storefront.setCartContact(orgSlug, token, dto);
  }

  @Public()
  @Post(":orgSlug/quote")
  quote(@Param("orgSlug") orgSlug: string, @Body() dto: QuoteDto) {
    return this.storefront.quote(orgSlug, dto);
  }

  @Public()
  @Post(":orgSlug/checkout")
  checkout(
    @Param("orgSlug") orgSlug: string,
    @Body() dto: CheckoutDto,
    @Headers(SHOP_SESSION_HEADER) sessionToken?: string,
  ) {
    return this.storefront.checkout(orgSlug, dto, sessionToken);
  }

  // ---------- EC25: storefront accounts (OTP auth) ----------

  @Public()
  @RateLimit(10, 60)
  @Post(":orgSlug/auth/request-otp")
  requestOtp(@Param("orgSlug") orgSlug: string, @Body() dto: RequestOtpDto) {
    return this.shopAccount.requestOtp(orgSlug, dto.phone);
  }

  @Public()
  @RateLimit(10, 60)
  @Post(":orgSlug/auth/verify")
  verifyOtp(@Param("orgSlug") orgSlug: string, @Body() dto: VerifyOtpDto) {
    return this.shopAccount.verifyOtp(orgSlug, dto.phone, dto.code);
  }

  @Public()
  @Post(":orgSlug/auth/logout")
  logout(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.logout(orgSlug, token);
  }

  @Public()
  @Get(":orgSlug/account/me")
  accountMe(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.me(orgSlug, token);
  }

  @Public()
  @Patch(":orgSlug/account/profile")
  updateProfile(
    @Param("orgSlug") orgSlug: string,
    @Headers(SHOP_SESSION_HEADER) token: string | undefined,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.shopAccount.updateProfile(orgSlug, token, dto);
  }

  @Public()
  @Get(":orgSlug/account/orders")
  accountOrders(
    @Param("orgSlug") orgSlug: string,
    @Headers(SHOP_SESSION_HEADER) token: string | undefined,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.shopAccount.listOrders(orgSlug, token, parseIntDef(page, 1), parseIntDef(pageSize, 20));
  }

  @Public()
  @Get(":orgSlug/account/orders/:orderId")
  accountOrder(
    @Param("orgSlug") orgSlug: string,
    @Param("orderId") orderId: string,
    @Headers(SHOP_SESSION_HEADER) token?: string,
  ) {
    return this.shopAccount.getOrder(orgSlug, token, orderId);
  }

  @Public()
  @Post(":orgSlug/account/orders/:orderId/reorder")
  accountReorder(
    @Param("orgSlug") orgSlug: string,
    @Param("orderId") orderId: string,
    @Headers(SHOP_SESSION_HEADER) token?: string,
  ) {
    return this.shopAccount.reorder(orgSlug, token, orderId);
  }

  @Public()
  @Get(":orgSlug/account/addresses")
  accountAddresses(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.listAddresses(orgSlug, token);
  }

  @Public()
  @Post(":orgSlug/account/addresses")
  createAddress(
    @Param("orgSlug") orgSlug: string,
    @Headers(SHOP_SESSION_HEADER) token: string | undefined,
    @Body() dto: CreateAddressDto,
  ) {
    return this.shopAccount.createAddress(orgSlug, token, dto);
  }

  @Public()
  @Patch(":orgSlug/account/addresses/:addressId")
  updateAddress(
    @Param("orgSlug") orgSlug: string,
    @Param("addressId") addressId: string,
    @Headers(SHOP_SESSION_HEADER) token: string | undefined,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.shopAccount.updateAddress(orgSlug, token, addressId, dto);
  }

  @Public()
  @Delete(":orgSlug/account/addresses/:addressId")
  deleteAddress(
    @Param("orgSlug") orgSlug: string,
    @Param("addressId") addressId: string,
    @Headers(SHOP_SESSION_HEADER) token?: string,
  ) {
    return this.shopAccount.deleteAddress(orgSlug, token, addressId);
  }

  @Public()
  @Get(":orgSlug/account/wishlist")
  accountWishlist(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.listWishlist(orgSlug, token);
  }

  @Public()
  @Post(":orgSlug/account/wishlist/merge")
  mergeWishlist(
    @Param("orgSlug") orgSlug: string,
    @Headers(SHOP_SESSION_HEADER) token: string | undefined,
    @Body() dto: MergeWishlistDto,
  ) {
    return this.shopAccount.mergeWishlist(orgSlug, token, dto.productIds);
  }

  @Public()
  @Post(":orgSlug/account/wishlist")
  addWishlist(
    @Param("orgSlug") orgSlug: string,
    @Headers(SHOP_SESSION_HEADER) token: string | undefined,
    @Body() dto: AddWishlistDto,
  ) {
    return this.shopAccount.addWishlist(orgSlug, token, dto.productId);
  }

  @Public()
  @Delete(":orgSlug/account/wishlist/:productId")
  removeWishlist(
    @Param("orgSlug") orgSlug: string,
    @Param("productId") productId: string,
    @Headers(SHOP_SESSION_HEADER) token?: string,
  ) {
    return this.shopAccount.removeWishlist(orgSlug, token, productId);
  }

  /** EC18: branded public order tracking (order number + phone).
   * Rate-limited: the pair is a credential, so guessing is capped. */
  @Public()
  @RateLimit(15, 60)
  @Post(":orgSlug/track")
  track(@Param("orgSlug") orgSlug: string, @Body() dto: TrackLookupDto) {
    return this.storefront.trackOrder(orgSlug, dto);
  }

  /** EC24b: digital download-link reveal — same lookup discipline
   * as track; links are returned only after delivery, under cap. */
  @Public()
  @RateLimit(15, 60)
  @Post(":orgSlug/track/digital-access")
  digitalAccess(@Param("orgSlug") orgSlug: string, @Body() dto: TrackLookupDto) {
    return this.storefront.digitalAccess(orgSlug, dto);
  }

  /** Automated Customer NDR Delivery Reschedule & Alternative Contact */
  @Public()
  @RateLimit(15, 60)
  @Post(":orgSlug/track/ndr-recovery")
  ndrRecovery(@Param("orgSlug") orgSlug: string, @Body() dto: NdrRecoveryDto) {
    return this.storefront.ndrRecovery(orgSlug, dto);
  }

  // ---------- EC28: retention ----------

  /** Back-in-stock subscription (only while actually out of stock). */
  @Public()
  @RateLimit(20, 60)
  @Post(":orgSlug/stock-alerts")
  subscribeStockAlert(
    @Param("orgSlug") orgSlug: string,
    @Body() dto: StockAlertSubscribeDto,
    @Headers(SHOP_SESSION_HEADER) sessionToken?: string,
  ) {
    return this.retention.subscribeStockAlert(orgSlug, dto, sessionToken);
  }

  /** Customer self-service return/exchange (tracking matcher). */
  @Public()
  @RateLimit(15, 60)
  @Post(":orgSlug/track/returns")
  createReturn(@Param("orgSlug") orgSlug: string, @Body() dto: CreateCustomerReturnDto) {
    return this.retention.createCustomerReturn(orgSlug, dto);
  }

  /** Product Q&A — published only. */
  @Public()
  @Get(":orgSlug/products/:productSlug/questions")
  questions(@Param("orgSlug") orgSlug: string, @Param("productSlug") productSlug: string) {
    return this.retention.publicQuestions(orgSlug, productSlug);
  }

  /** Product Q&A — ask (lands as pending, not public yet). */
  @Public()
  @RateLimit(10, 60)
  @Post(":orgSlug/products/:productSlug/questions")
  askQuestion(
    @Param("orgSlug") orgSlug: string,
    @Param("productSlug") productSlug: string,
    @Body() dto: AskProductQuestionDto,
  ) {
    return this.retention.askQuestion(orgSlug, productSlug, dto);
  }
}

const QUESTION_MODERATION_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/** EC28 — staff product Q&A moderation (commerce area, mirroring
 * the EC15 product-reviews moderation controller's guard shape). */
@PermissionArea("orders")
@Controller("organizations/:organizationId/product-questions")
@UseGuards(TenantGuard, RolesGuard)
export class ProductQuestionsStaffController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  @Roles(...QUESTION_MODERATION_ROLES)
  list(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.retention.staffListQuestions(orgId, status || undefined);
  }

  @Post(":questionId/answer")
  @Roles(...QUESTION_MODERATION_ROLES)
  answer(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("questionId") questionId: string,
    @Body() dto: AnswerProductQuestionDto,
  ) {
    return this.retention.staffAnswerQuestion(orgId, user.userId, questionId, dto.answer);
  }

  @Post(":questionId/visibility")
  @Roles(...QUESTION_MODERATION_ROLES)
  visibility(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("questionId") questionId: string,
    @Body() dto: QuestionVisibilityDto,
  ) {
    return this.retention.staffSetQuestionVisibility(orgId, user.userId, questionId, dto.hidden === true);
  }

  @Delete(":questionId")
  @Roles(...QUESTION_MODERATION_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("questionId") questionId: string,
  ) {
    return this.retention.staffDeleteQuestion(orgId, user.userId, questionId);
  }
}

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;
const ADMIN_ROLES = ["OWNER", "ADMIN"] as const;

/** EC8 staff storefront administration (settings, zones, domain). */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/storefront")
@UseGuards(TenantGuard, RolesGuard)
export class StorefrontStaffController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly deliveryPricing: DeliveryPricingService,
  ) {}

  @Get()
  state(@Param("organizationId") orgId: string) {
    return this.storefront.staffState(orgId);
  }

  @Patch("settings")
  @Roles(...WRITE_ROLES)
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdateStorefrontSettingsDto,
  ) {
    return this.storefront.updateSettings(orgId, user.userId, dto);
  }

  @Post("zones")
  @Roles(...WRITE_ROLES)
  createZone(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.storefront.createZone(orgId, user.userId, dto);
  }

  @Post("zones/defaults")
  @Roles(...WRITE_ROLES)
  createDefaultZones(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.storefront.createDefaultZones(orgId, user.userId);
  }

  @Patch("zones/:zoneId")
  @Roles(...WRITE_ROLES)
  updateZone(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("zoneId") zoneId: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.storefront.updateZone(orgId, user.userId, zoneId, dto);
  }

  @Delete("zones/:zoneId")
  @Roles(...ADMIN_ROLES)
  deleteZone(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("zoneId") zoneId: string,
  ) {
    return this.storefront.deleteZone(orgId, user.userId, zoneId);
  }

  // EC18: delivery slots (staff CRUD, mirroring zones).
  @Post("slots")
  @Roles(...WRITE_ROLES)
  createSlot(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateDeliverySlotDto,
  ) {
    return this.storefront.createSlot(orgId, user.userId, dto);
  }

  @Patch("slots/:slotId")
  @Roles(...WRITE_ROLES)
  updateSlot(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("slotId") slotId: string,
    @Body() dto: UpdateDeliverySlotDto,
  ) {
    return this.storefront.updateSlot(orgId, user.userId, slotId, dto);
  }

  @Delete("slots/:slotId")
  @Roles(...ADMIN_ROLES)
  deleteSlot(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("slotId") slotId: string,
  ) {
    return this.storefront.deleteSlot(orgId, user.userId, slotId);
  }

  // EC30: weight-based shipping rate rules (staff CRUD, mirroring zones).
  @Get("rate-rules")
  listRateRules(@Param("organizationId") orgId: string) {
    return this.deliveryPricing.listRules(orgId);
  }

  @Post("rate-rules")
  @Roles(...WRITE_ROLES)
  createRateRule(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateShippingRateRuleDto,
  ) {
    return this.deliveryPricing.createRule(orgId, user.userId, dto);
  }

  @Patch("rate-rules/:ruleId")
  @Roles(...WRITE_ROLES)
  updateRateRule(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("ruleId") ruleId: string,
    @Body() dto: UpdateShippingRateRuleDto,
  ) {
    return this.deliveryPricing.updateRule(orgId, user.userId, ruleId, dto);
  }

  @Delete("rate-rules/:ruleId")
  @Roles(...ADMIN_ROLES)
  deleteRateRule(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("ruleId") ruleId: string,
  ) {
    return this.deliveryPricing.deleteRule(orgId, user.userId, ruleId);
  }

  // EC30: pickup points (staff CRUD, mirroring zones).
  @Get("pickup-points")
  listPickupPoints(@Param("organizationId") orgId: string) {
    return this.deliveryPricing.listPoints(orgId);
  }

  @Post("pickup-points")
  @Roles(...WRITE_ROLES)
  createPickupPoint(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreatePickupPointDto,
  ) {
    return this.deliveryPricing.createPoint(orgId, user.userId, dto);
  }

  @Patch("pickup-points/:pointId")
  @Roles(...WRITE_ROLES)
  updatePickupPoint(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("pointId") pointId: string,
    @Body() dto: UpdatePickupPointDto,
  ) {
    return this.deliveryPricing.updatePoint(orgId, user.userId, pointId, dto);
  }

  @Delete("pickup-points/:pointId")
  @Roles(...ADMIN_ROLES)
  deletePickupPoint(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("pointId") pointId: string,
  ) {
    return this.deliveryPricing.deletePoint(orgId, user.userId, pointId);
  }

  @Post("domain/verify-token")
  @Roles(...ADMIN_ROLES)
  verifyToken(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.storefront.issueDomainVerifyToken(orgId, user.userId);
  }

  @Post("domain/verify")
  @Roles(...ADMIN_ROLES)
  verify(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.storefront.verifyDomain(orgId, user.userId);
  }

  @Post("domain/check-routing")
  @Roles(...ADMIN_ROLES)
  checkRouting(@Param("organizationId") orgId: string) {
    return this.storefront.checkDomainRouting(orgId);
  }
}
