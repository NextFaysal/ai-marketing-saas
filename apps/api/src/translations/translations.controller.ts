import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { TranslationsService } from "./translations.service";
import type {
  AiProductDraftDto, AiStringsDraftDto, UpdateTranslationDto, UpsertCurrencyRateDto, UpsertTranslationDto,
} from "./translations.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF5 (FB3) — staff surface for storefront translations and
 * display currencies. Follows the products controller pattern:
 * TenantGuard on the class, RolesGuard + the products WRITE_ROLES
 * on writes; reads open to any tenant member. Routes live under
 * organizations/:organizationId next to products so the dashboard
 * product-edit panel calls them beside the product endpoints.
 * "translations/ai-draft" is declared before "translations/:id"
 * so the literal segment is never captured as an id.
 */
const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

@Controller("organizations/:organizationId")
@UseGuards(TenantGuard)
export class TranslationsController {
  constructor(private readonly translations: TranslationsService) {}

  @Get("products/:productId/translations")
  listForProduct(@Param("organizationId") orgId: string, @Param("productId") productId: string) {
    return this.translations.listForProduct(orgId, productId);
  }

  @Post("products/:productId/translations/ai-draft")
  @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiProductDraft(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("productId") productId: string,
    @Body() dto: AiProductDraftDto,
  ) {
    return this.translations.generateProductDraft(orgId, user.userId, productId, dto);
  }

  @Get("storefront-string-translations")
  listStrings(@Param("organizationId") orgId: string) {
    return this.translations.listStorefrontStrings(orgId);
  }

  @Post("storefront-string-translations/ai-draft")
  @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiStringsDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AiStringsDraftDto) {
    return this.translations.generateStringsDraft(orgId, user.userId, dto);
  }

  @Post("translations")
  @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  upsert(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpsertTranslationDto) {
    return this.translations.upsertHuman(orgId, user.userId, dto);
  }

  @Patch("translations/:id")
  @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: UpdateTranslationDto,
  ) {
    return this.translations.updateTranslation(orgId, user.userId, id, dto);
  }

  @Get("display-currency-rates")
  listRates(@Param("organizationId") orgId: string) {
    return this.translations.listCurrencyRates(orgId);
  }

  @Post("display-currency-rates")
  @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  upsertRate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpsertCurrencyRateDto) {
    return this.translations.upsertCurrencyRate(orgId, user.userId, dto);
  }

  @Delete("display-currency-rates/:currency")
  @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteRate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("currency") currency: string) {
    return this.translations.deleteCurrencyRate(orgId, user.userId, currency);
  }
}
