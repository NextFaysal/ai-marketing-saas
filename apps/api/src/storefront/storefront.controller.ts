import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { clientIpFromRequest } from "../fraud/client-ip";
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
  ContactMessageDto,
  CreateSearchSynonymDto,
  UpdateSearchSynonymDto,
  CreateBlogPostDto,
  UpdateBlogPostDto,
  ExpressCheckoutDto,
  CreateAddressDto,
  CreateShopPageDto,
  PopupEventDto,
  PopupLeadDto,
  UpdateShopPageDto,
  UpsertStorePopupDto,
  CreateDeliverySlotDto,
  CreatePickupPointDto,
  GiftCardBalanceDto,
  CreateShippingRateRuleDto,
  CreateZoneDto,
  MergeWishlistDto,
  PatchCartBundleDto,
  PatchCartLineDto,
  QuoteDto,
  SetCustomDomainDto,
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
  private readonly logger = new Logger(PublicShopController.name);

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

  /**
   * TD10: the "ask" endpoint the web middleware's custom-domain
   * path consults — is this host a VERIFIED shop domain (or its
   * www/apex variant)? Allowed answers 200 { allowed: true };
   * anything else is a plain 404 (logged here for diagnosis).
   * NOTE: abuse of this probe is already capped by the global
   * ThrottlerGuard registered as APP_GUARD in app.module.ts —
   * no per-route limiter is added on purpose.
   * Declared BEFORE `:orgSlug` (like by-domain above) so
   * "domain-allowed" is never captured as an org slug.
   */
  @Public()
  @Get("domain-allowed")
  async domainAllowed(@Query("domain") domain?: string) {
    const allowed = await this.storefront.domainAllowed(domain ?? "");
    if (allowed) return { allowed: true };
    this.logger.warn(`domain-allowed denied for domain="${domain ?? ""}"`);
    throw new NotFoundException("ডোমেইনটি পাওয়া যায়নি");
  }

  @Public()
  @Get(":orgSlug")
  home(
    @Param("orgSlug") orgSlug: string,
    @Query("q") q?: string,
    @Query("category") category?: string,
    @Query("brand") brand?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("sort") sort?: string,
    @Query("ids") ids?: string,
    // NF5 (FB3): shopper locale choice (bn | en | hi); unsupported
    // values fall back to the org's StorefrontSetting.locale.
    @Query("locale") locale?: string,
  ) {
    return this.storefront.shopHome(orgSlug, {
      q: q || undefined,
      category: category || undefined,
      // GB2 (GC6): brand filter by slug.
      brand: brand || undefined,
      page: parseIntDef(page, 1),
      pageSize: parseIntDef(pageSize, 24),
      sort: sort || undefined,
      // AB6 (AX14): explicit product-id list mode (see service).
      ids: ids || undefined,
      locale: locale || undefined,
    });
  }

  /** GB2 (GC6): public brand page (brand info + its ACTIVE
   * products). The literal "brands" segment cannot be captured
   * by the product-slug route. */
  @Public()
  @Get(":orgSlug/brands/:brandSlug")
  brandPage(@Param("orgSlug") orgSlug: string, @Param("brandSlug") brandSlug: string) {
    return this.storefront.shopBrandPage(orgSlug, brandSlug);
  }

  /** GB7: public flash-sales countdown payload (live sales +
   * their products + serverNow). Distinct segment count from
   * the product-slug route, so ordering is safe. */
  @Public()
  @Get(":orgSlug/flash-sales")
  flashSales(@Param("orgSlug") orgSlug: string) {
    return this.storefront.publicFlashSales(orgSlug);
  }

  /** NF14 (FB5): public offers payload (active StoreDiscount
   * offers, public-safe fields, `appOnly` per offer for the
   * storefront's standalone display rule). */
  @Public()
  @Get(":orgSlug/offers")
  offers(@Param("orgSlug") orgSlug: string) {
    return this.storefront.publicOffers(orgSlug);
  }

  /** AB6 (AX14): cart cross-sell recommendations — products
   * bought together with any of the given cart product ids.
   * `context` is accepted for forward compatibility and ignored
   * in v1 (only "cart" exists). Distinct segment count from the
   * product-slug route, so ordering is safe. */
  @Public()
  @Get(":orgSlug/recommendations")
  recommendations(
    @Param("orgSlug") orgSlug: string,
    @Query("productIds") productIds?: string,
    @Query("context") context?: string,
  ) {
    void context;
    return this.storefront.cartRecommendations(orgSlug, productIds ?? "");
  }

  @Public()
  @Get(":orgSlug/products/:productSlug")
  product(@Param("orgSlug") orgSlug: string, @Param("productSlug") productSlug: string, @Query("locale") locale?: string) {
    return this.storefront.productDetail(orgSlug, productSlug, locale || undefined);
  }

  /** GB1 (GC2): a published shop content page. Declared after
   * the product route; the literal "pages" segment cannot be
   * captured by the product-slug route. */
  @Public()
  @Get(":orgSlug/pages/:pageSlug")
  publicPage(@Param("orgSlug") orgSlug: string, @Param("pageSlug") pageSlug: string) {
    return this.storefront.getPublicPage(orgSlug, pageSlug);
  }

  /** AB6 (AX12): the shop's published blog posts. */
  @Public()
  @Get(":orgSlug/blog")
  publicBlog(@Param("orgSlug") orgSlug: string) {
    return this.storefront.listPublicBlogPosts(orgSlug);
  }

  /** AB6 (AX12): one published blog post (drafts 404). */
  @Public()
  @Get(":orgSlug/blog/:postSlug")
  publicBlogPost(@Param("orgSlug") orgSlug: string, @Param("postSlug") postSlug: string) {
    return this.storefront.getPublicBlogPost(orgSlug, postSlug);
  }

  /** GB1 (GC3): the shop's live popup (null when none applies). */
  @Public()
  @Get(":orgSlug/popup")
  publicPopup(@Param("orgSlug") orgSlug: string) {
    return this.storefront.getPublicPopup(orgSlug);
  }

  /** GB1 (GC3): popup impression/click counter (always ok). */
  @Public()
  @RateLimit(60, 60)
  /** OU8: lead-capture popup submission → a real Lead row. */
  @Public()
  @Post(":orgSlug/popup-lead")
  popupLead(@Param("orgSlug") orgSlug: string, @Body() dto: PopupLeadDto) {
    return this.storefront.submitPopupLead(orgSlug, dto);
  }

  @Post(":orgSlug/popup-event")
  popupEvent(@Param("orgSlug") orgSlug: string, @Body() dto: PopupEventDto) {
    return this.storefront.recordPopupEvent(orgSlug, dto.kind);
  }

  /** GB1 (GC2): shop contact form (staff-notify + email, stored always). */
  @Public()
  @RateLimit(5, 60)
  @Post(":orgSlug/contact")
  contact(@Param("orgSlug") orgSlug: string, @Body() dto: ContactMessageDto) {
    return this.storefront.submitContactMessage(orgSlug, dto);
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
    @Req() req: any,
    @Headers(SHOP_SESSION_HEADER) sessionToken?: string,
  ) {
    return this.storefront.checkout(orgSlug, dto, sessionToken, { ip: clientIpFromRequest(req) });
  }

  /** AB4 (AX5c): express checkout — signed-in customers place
   * the cart against a saved address in one call (the session
   * header is required by the service, which 400s without a
   * valid session). */
  @Public()
  @Post(":orgSlug/express-checkout")
  expressCheckout(
    @Param("orgSlug") orgSlug: string,
    @Body() dto: ExpressCheckoutDto,
    @Req() req: any,
    @Headers(SHOP_SESSION_HEADER) sessionToken?: string,
  ) {
    return this.storefront.expressCheckout(orgSlug, sessionToken, dto, { ip: clientIpFromRequest(req) });
  }

  // ---------- EC25: storefront accounts (OTP auth) ----------

  @Public()
  @RateLimit(10, 60)
  @Post(":orgSlug/auth/request-otp")
  requestOtp(@Param("orgSlug") orgSlug: string, @Body() dto: RequestOtpDto, @Req() req: any) {
    return this.shopAccount.requestOtp(orgSlug, dto.phone, {
      captchaToken: dto.captchaToken ?? null,
      ip: clientIpFromRequest(req),
    });
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

  /** AB1 (AX1/AX2): the signed-in customer's points balance,
   * history, referral code and referral rewards. */
  @Public()
  @Get(":orgSlug/account/loyalty")
  accountLoyalty(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.loyaltyView(orgSlug, token);
  }

  /** NF7 (FB3): the signed-in customer's store-credit balance,
   * ledger history and current membership tier. */
  @Public()
  @Get(":orgSlug/account/store-credit")
  accountStoreCredit(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.creditView(orgSlug, token);
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

  /** MX14: the signed-in customer's on-site notification center
   * (rows written by Messaging onsite broadcasts). Session-gated
   * inside ShopAccountService like every account surface. */
  @Public()
  @Get(":orgSlug/account/notifications")
  accountNotifications(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.listNotifications(orgSlug, token);
  }

  @Public()
  @Post(":orgSlug/account/notifications/read-all")
  accountNotificationsReadAll(@Param("orgSlug") orgSlug: string, @Headers(SHOP_SESSION_HEADER) token?: string) {
    return this.shopAccount.markAllNotificationsRead(orgSlug, token);
  }

  @Public()
  @Post(":orgSlug/account/notifications/:notificationId/read")
  accountNotificationRead(
    @Param("orgSlug") orgSlug: string,
    @Param("notificationId") notificationId: string,
    @Headers(SHOP_SESSION_HEADER) token?: string,
  ) {
    return this.shopAccount.markNotificationRead(orgSlug, token, notificationId);
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

  /** AB5 (AX9): signed digital download — the token (minted by
   * the reveal) is the credential, so this answers with a raw
   * @Res response: 302 to the merchant file on success, one
   * generic Bengali 403 page for every failure. */
  @Public()
  @Get(":orgSlug/orders/:orderId/digital-download")
  async digitalDownload(
    @Param("orgSlug") orgSlug: string,
    @Param("orderId") orderId: string,
    @Query("token") token: string | undefined,
    @Res() res: Response,
  ) {
    return this.storefront.digitalDownload(orgSlug, orderId, token, res as any);
  }

  /** AB2 (AX3): public gift-card balance lookup — the code is a
   * bearer credential, so this is rate-limited like the track
   * routes and answers generically for unknown codes. Declared
   * in the track section: the literal "gift-cards" segment
   * cannot be captured by any product-slug route. */
  @Public()
  @RateLimit(10, 60)
  @Post(":orgSlug/gift-cards/balance")
  giftCardBalance(@Param("orgSlug") orgSlug: string, @Body() dto: GiftCardBalanceDto) {
    return this.storefront.giftCardBalance(orgSlug, dto);
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

  // GB1 (GC2): shop content pages (staff CRUD).
  @Get("pages")
  listPages(@Param("organizationId") orgId: string) {
    return this.storefront.listPages(orgId);
  }

  @Post("pages")
  @Roles(...WRITE_ROLES)
  createPage(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateShopPageDto,
  ) {
    return this.storefront.createPage(orgId, user.userId, dto);
  }

  @Patch("pages/:pageId")
  @Roles(...WRITE_ROLES)
  updatePage(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("pageId") pageId: string,
    @Body() dto: UpdateShopPageDto,
  ) {
    return this.storefront.updatePage(orgId, user.userId, pageId, dto);
  }

  @Delete("pages/:pageId")
  @Roles(...WRITE_ROLES)
  deletePage(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("pageId") pageId: string,
  ) {
    return this.storefront.deletePage(orgId, user.userId, pageId);
  }

  // AB6 (AX12): shop blog posts (staff CRUD).
  @Get("blog")
  listBlogPosts(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.storefront.listBlogPosts(orgId, status);
  }

  @Post("blog")
  @Roles(...WRITE_ROLES)
  createBlogPost(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateBlogPostDto,
  ) {
    return this.storefront.createBlogPost(orgId, user.userId, dto);
  }

  @Patch("blog/:postId")
  @Roles(...WRITE_ROLES)
  updateBlogPost(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("postId") postId: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.storefront.updateBlogPost(orgId, user.userId, postId, dto);
  }

  @Delete("blog/:postId")
  @Roles(...WRITE_ROLES)
  deleteBlogPost(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("postId") postId: string,
  ) {
    return this.storefront.deleteBlogPost(orgId, user.userId, postId);
  }

  // AB6 (AX11): search analytics + synonyms + reindex (staff).
  @Get("search/analytics")
  searchAnalytics(@Param("organizationId") orgId: string) {
    return this.storefront.searchAnalytics(orgId);
  }

  @Get("search/synonyms")
  listSynonyms(@Param("organizationId") orgId: string) {
    return this.storefront.listSynonyms(orgId);
  }

  @Post("search/synonyms")
  @Roles(...WRITE_ROLES)
  createSynonym(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateSearchSynonymDto,
  ) {
    return this.storefront.createSynonym(orgId, user.userId, dto);
  }

  @Patch("search/synonyms/:synonymId")
  @Roles(...WRITE_ROLES)
  updateSynonym(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("synonymId") synonymId: string,
    @Body() dto: UpdateSearchSynonymDto,
  ) {
    return this.storefront.updateSynonym(orgId, user.userId, synonymId, dto);
  }

  @Delete("search/synonyms/:synonymId")
  @Roles(...WRITE_ROLES)
  deleteSynonym(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("synonymId") synonymId: string,
  ) {
    return this.storefront.deleteSynonym(orgId, user.userId, synonymId);
  }

  @Post("search/reindex")
  @Roles(...WRITE_ROLES)
  reindexSearch(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.storefront.reindexSearch(orgId, user.userId);
  }

  // GB1 (GC3): the shop popup config (staff read + upsert).
  @Get("popup")
  getPopup(@Param("organizationId") orgId: string) {
    return this.storefront.getPopupConfig(orgId);
  }

  @Put("popup")
  @Roles(...WRITE_ROLES)
  upsertPopup(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpsertStorePopupDto,
  ) {
    return this.storefront.upsertPopup(orgId, user.userId, dto);
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

  /** TD9: set / change / remove the custom domain (resets
   * verification on a real change — see setCustomDomain). */
  @Post("domain/set")
  @Roles(...ADMIN_ROLES)
  setDomain(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: SetCustomDomainDto,
  ) {
    return this.storefront.setCustomDomain(orgId, user.userId, dto.domain ?? null);
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

  /** OU2: manual Cloudflare-for-SaaS HTTPS status refresh — same
   * guard/role pattern as the neighbouring domain endpoints
   * (TenantGuard + RolesGuard, OWNER/ADMIN). No webhooks/polling:
   * the persisted state moves only on this call or on (re-)
   * verification. */
  @Post("domain/https-refresh")
  @Roles(...ADMIN_ROLES)
  httpsRefresh(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.storefront.refreshDomainHttps(orgId, user.userId);
  }
}
