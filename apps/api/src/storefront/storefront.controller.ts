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
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import {
  CART_TOKEN_HEADER,
  CartContactDto,
  CheckoutDto,
  CreateZoneDto,
  PatchCartLineDto,
  QuoteDto,
  UpdateStorefrontSettingsDto,
  UpdateZoneDto,
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
  constructor(private readonly storefront: StorefrontService) {}

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
  checkout(@Param("orgSlug") orgSlug: string, @Body() dto: CheckoutDto) {
    return this.storefront.checkout(orgSlug, dto);
  }
}

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;
const ADMIN_ROLES = ["OWNER", "ADMIN"] as const;

/** EC8 staff storefront administration (settings, zones, domain). */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/storefront")
@UseGuards(TenantGuard, RolesGuard)
export class StorefrontStaffController {
  constructor(private readonly storefront: StorefrontService) {}

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
