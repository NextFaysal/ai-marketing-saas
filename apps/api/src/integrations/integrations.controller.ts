import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { CreateStoreDto, ConnectWooDto, ConnectShopifyDto, StartWcAuthDto } from "./integrations.dto";
import { WooAuthService } from "./woo-auth.service";
import { ShopifyService } from "./shopify/shopify.service";
import { StoreHealthService } from "./commerce/health.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { badRequest } from "../i18n/api-exception";

const WRITE_ROLES = ["OWNER", "ADMIN"];

@PermissionArea("integrations")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService, private readonly shopify: ShopifyService, private readonly health: StoreHealthService, private readonly wooAuth: WooAuthService) {}

  @Post("stores") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createStore(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateStoreDto) {
    return this.integrations.createStore(orgId, user.userId, dto);
  }

  @Get("stores")
  listStores(@Param("organizationId") orgId: string) { return this.integrations.listStores(orgId); }

  @Post("integrations/woocommerce/connect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  connect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectWooDto) {
    return this.integrations.connectWooCommerce(orgId, user.userId, dto);
  }

  // EC12: WooCommerce wc-auth 1-click connect — returns the store's
  // authorize URL; Woo POSTs the generated keys to the public
  // callback (WooAuthController) after the merchant approves.
  @Post("integrations/woocommerce/wc-auth/authorize-url") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  startWcAuth(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: StartWcAuthDto) {
    return this.wooAuth.startAuthorizeUrl(orgId, user.userId, dto);
  }

  @Get("integrations")
  list(@Param("organizationId") orgId: string) { return this.integrations.listIntegrations(orgId); }

  @Post("integrations/:integrationId/disconnect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string, @Body() body?: { purgeMappings?: boolean }, @Req() req?: any) {
    // EC12: no body (the web page's current call) = historical
    // keep-everything disconnect. purgeMappings is OWNER-gated in
    // the service via the caller's membership role.
    return this.integrations.disconnect(orgId, user.userId, id, {
      purgeMappings: body?.purgeMappings === true,
      actorRole: (req as any)?.membership?.role,
    });
  }

  // EC12: webhook secret rotation — OWNER only (stricter than
  // WRITE_ROLES): a rotation invalidates the old secret everywhere.
  @Post("integrations/:integrationId/rotate-webhook-secret") @UseGuards(RolesGuard) @Roles("OWNER")
  async rotateWebhookSecret(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    if (integration.provider === "shopify") {
      return {
        rotated: false,
        reason: "shopify_app_level_secret",
        message: "Shopify-র webhook secret অ্যাপ-স্তরের (App Secret) — এটি এখান থেকে ঘোরানো যায় না। Shopify Partners/Dev Dashboard-এ অ্যাপের Client Secret বদলালে এখানে Shopify আবার কানেক্ট করতে হবে।",
      };
    }
    if (integration.provider === "woocommerce") return this.integrations.rotateWooWebhookSecret(orgId, user.userId, id);
    throw badRequest("integrations.webhookSecretRotationIsOnlyAvailable2");
  }

  @Post("integrations/shopify/connect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  connectShopify(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectShopifyDto) {
    if (dto.clientId || dto.clientSecret) {
      if (!dto.clientId || !dto.clientSecret) throw badRequest("integrations.giveBothClientidAndClientsecret");
      return this.shopify.connectClientCredentials(orgId, user.userId, dto as any);
    }
    if (!dto.accessToken || !dto.apiSecret) {
      throw badRequest("integrations.giveAccesstokenApisecretOrClientidClientsecret");
    }
    return this.shopify.connect(orgId, user.userId, dto as { storeId: string; accessToken: string; apiSecret: string });
  }

  @Post("integrations/:integrationId/repair-webhooks") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async repairWebhooks(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    if (integration.provider === "shopify") return this.shopify.repairWebhooks(orgId, user.userId, id);
    if (integration.provider === "woocommerce") return this.integrations.repairWooWebhooks(orgId, user.userId, id);
    throw badRequest("integrations.webhookRepairIsOnlyAvailableFor3");
  }

  @Get("integrations/:integrationId/health")
  healthCheck(@Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.health.getHealth(orgId, id);
  }

  /** CC18: manual sync triggers REFUSE a paused connection
   * with a clear message (the scheduled path instead skips
   * quietly-but-logged inside the services). */
  private assertSyncNotPaused(integration: any) {
    if (integration?.syncPaused === true) {
      throw badRequest("integrations.thisConnectionSSyncIsPaused");
    }
  }

  @Post("integrations/:integrationId/sync/products") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async syncProducts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string, @Body() body?: { bulk?: boolean }) {
    const integration = await this.integrations.getIntegration(orgId, id);
    this.assertSyncNotPaused(integration);
    // EC12: Shopify-only bulk mode (falls back to REST in-service).
    if (integration.provider === "shopify") return this.shopify.syncProducts(orgId, user.userId, id, { bulk: body?.bulk === true });
    return this.integrations.syncProducts(orgId, user.userId, id);
  }

  @Post("integrations/:integrationId/sync/orders") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async syncOrders(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    this.assertSyncNotPaused(integration);
    if (integration.provider === "shopify") return this.shopify.syncOrders(orgId, user.userId, id);
    return this.integrations.syncOrders(orgId, user.userId, id);
  }

  @Post("integrations/:integrationId/sync/customers") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async syncCustomers(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    this.assertSyncNotPaused(integration);
    if (integration.provider === "shopify") return this.shopify.syncCustomers(orgId, user.userId, id);
    return this.integrations.syncCustomers(orgId, user.userId, id);
  }

  @Post("integrations/:integrationId/sync/reviews") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async syncReviews(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    this.assertSyncNotPaused(integration);
    return this.integrations.syncReviews(orgId, user.userId, id);
  }

  @Get("integrations/:integrationId/sync-jobs")
  syncJobs(@Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.integrations.listSyncJobs(orgId, id);
  }
}
