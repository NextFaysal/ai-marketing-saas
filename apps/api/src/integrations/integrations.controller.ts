import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { CreateStoreDto, ConnectWooDto, ConnectShopifyDto } from "./integrations.dto";
import { ShopifyService } from "./shopify/shopify.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN"];

@PermissionArea("integrations")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService, private readonly shopify: ShopifyService) {}

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

  @Get("integrations")
  list(@Param("organizationId") orgId: string) { return this.integrations.listIntegrations(orgId); }

  @Post("integrations/:integrationId/disconnect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.integrations.disconnect(orgId, user.userId, id);
  }

  @Post("integrations/shopify/connect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  connectShopify(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectShopifyDto) {
    return this.shopify.connect(orgId, user.userId, dto);
  }

  @Post("integrations/:integrationId/sync/products") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async syncProducts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    if (integration.provider === "shopify") return this.shopify.syncProducts(orgId, user.userId, id);
    return this.integrations.syncProducts(orgId, user.userId, id);
  }

  @Post("integrations/:integrationId/sync/orders") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async syncOrders(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    const integration = await this.integrations.getIntegration(orgId, id);
    if (integration.provider === "shopify") return this.shopify.syncOrders(orgId, user.userId, id);
    return this.integrations.syncOrders(orgId, user.userId, id);
  }

  @Get("integrations/:integrationId/sync-jobs")
  syncJobs(@Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.integrations.listSyncJobs(orgId, id);
  }
}
