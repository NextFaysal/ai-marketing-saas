import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ConnectionsService } from "./connections.service";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { CreatePayoutRequestDto, InitiateOrderPaymentDto, PublicInitiatePaymentDto, PutAppConfigDto, PutLlmConfigDto, PutPaymentGatewayDto, SetGatewayEnabledDto, SetPlatformEnabledDto } from "./connections.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN"];

/**
 * CC1/CC2 — Connect Center endpoints. Same guard stack as the
 * integrations controller: tenant membership via TenantGuard,
 * role/permission checks via RolesGuard, area "integrations".
 */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/connections")
@UseGuards(TenantGuard, RolesGuard)
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly tenantPayments: TenantPaymentsService,
    private readonly wallet: WalletService,
  ) {}

  @Get("overview")
  overview(@Param("organizationId") orgId: string) {
    return this.connections.getOverview(orgId);
  }

  // CC3 — the tenant's OWN app configs (Meta / TikTok). Reads are
  // open to any tenant member who can see the area; writes are
  // OWNER/ADMIN, same as every other connections mutation.
  @Get("app-configs")
  listAppConfigs(@Param("organizationId") orgId: string) {
    return this.connections.listAppConfigs(orgId);
  }

  @Put("app-configs/:platform") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putAppConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("platform") platform: string, @Body() dto: PutAppConfigDto) {
    return this.connections.putAppConfig(orgId, user.userId, platform, dto);
  }

  @Delete("app-configs/:platform") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteAppConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("platform") platform: string) {
    return this.connections.deleteAppConfig(orgId, user.userId, platform);
  }

  // CC8 — the tenant's OWN LLM key (verify-before-save; the key
  // itself is never returned). Literal routes, declared before
  // the :integrationId routes below.
  @Get("llm-config")
  getLlmConfig(@Param("organizationId") orgId: string) {
    return this.connections.getLlmConfig(orgId);
  }

  @Put("llm-config") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putLlmConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PutLlmConfigDto) {
    return this.connections.putLlmConfig(orgId, user.userId, dto);
  }

  @Delete("llm-config") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteLlmConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.connections.deleteLlmConfig(orgId, user.userId);
  }

  // CC9 — the tenant's OWN payment gateways (money settles
  // directly to the tenant). Literal routes, declared before the
  // :integrationId routes below. Writes are OWNER/ADMIN.
  @Get("payment-gateways")
  listPaymentGateways(@Param("organizationId") orgId: string) {
    return this.tenantPayments.listGateways(orgId);
  }

  @Put("payment-gateways/:provider") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putPaymentGateway(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: PutPaymentGatewayDto) {
    return this.tenantPayments.putGateway(orgId, user.userId, provider, dto);
  }

  @Patch("payment-gateways/:provider/enabled") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setPaymentGatewayEnabled(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: SetGatewayEnabledDto) {
    return this.tenantPayments.setGatewayEnabled(orgId, user.userId, provider, dto.isEnabled);
  }

  @Delete("payment-gateways/:provider") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deletePaymentGateway(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string) {
    return this.tenantPayments.deleteGateway(orgId, user.userId, provider);
  }

  @Post("payment-gateways/:provider/initiate-payment") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  initiatePayment(@Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: InitiateOrderPaymentDto) {
    return this.tenantPayments.initiateOrderPayment(orgId, dto.orderId, provider, {
      customerName: dto.customerName, customerPhone: dto.customerPhone, customerEmail: dto.customerEmail,
    });
  }

  // CC10 — Platform Payment + Wallet. Literal routes, declared
  // before the :integrationId routes below. The wallet surface
  // is read + payout-request only: there is deliberately NO
  // tenant endpoint that creates a ledger row or a credit.
  @Get("platform-payments")
  listPlatformPayments(@Param("organizationId") orgId: string) {
    return this.wallet.listPlatformPayments(orgId);
  }

  @Put("platform-payments/:provider/enabled") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setPlatformEnabled(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: SetPlatformEnabledDto) {
    return this.wallet.setPlatformEnabled(orgId, user.userId, provider, dto.isEnabled);
  }

  @Post("platform-payments/:provider/initiate-payment") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  initiatePlatformPayment(@Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: InitiateOrderPaymentDto) {
    return this.tenantPayments.initiatePlatformOrderPayment(orgId, dto.orderId, provider, {
      customerName: dto.customerName, customerPhone: dto.customerPhone, customerEmail: dto.customerEmail,
    });
  }

  @Get("wallet")
  getWallet(@Param("organizationId") orgId: string) {
    return this.wallet.getWallet(orgId);
  }

  @Get("payout-requests")
  listPayoutRequests(@Param("organizationId") orgId: string) {
    return this.wallet.listPayoutRequests(orgId);
  }

  @Post("payout-requests") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPayoutRequest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePayoutRequestDto) {
    return this.wallet.createPayoutRequest(orgId, user.userId, dto);
  }

  @Post("payout-requests/:requestId/cancel") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  cancelPayoutRequest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("requestId") requestId: string) {
    return this.wallet.cancelPayoutRequest(orgId, user.userId, requestId);
  }

  @Patch(":integrationId/default") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setDefault(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.connections.setDefault(orgId, user.userId, id);
  }

  @Post(":integrationId/disconnect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.connections.disconnect(orgId, user.userId, id);
  }
}

/**
 * CC9 — public gateway endpoints for TENANT gateways. The IPN is
 * the ONLY SSLCommerz activation path; the browser return just
 * redirects with an informational flag. The bKash callback
 * activates only after the server-to-server execute/query
 * confirmation inside the service. No tenant guard — the trust
 * comes from the gateway verification chain, exactly like the
 * platform payments public controllers (M36/M39).
 */
@Controller("public/tenant-payments")
export class TenantPaymentsPublicController {
  constructor(private readonly tenantPayments: TenantPaymentsService) {}

  @Public() @Post("initiate/:orgSlug")
  initiate(@Param("orgSlug") orgSlug: string, @Body() dto: PublicInitiatePaymentDto) {
    return this.tenantPayments.initiatePublicPayment(orgSlug, dto.orderId, dto.orderNumber, dto.provider, dto.source);
  }

  @Public() @Post("sslcommerz/ipn")
  sslIpn(@Body() body: Record<string, any>) {
    return this.tenantPayments.handleSslIpn(body ?? {});
  }

  @Public() @Post("sslcommerz/return")
  async sslReturnPost(@Body() body: Record<string, any>, @Res() res: Response) {
    return res.redirect(302, await this.tenantPayments.sslReturnRedirect(body ?? {}));
  }

  @Public() @Get("sslcommerz/return")
  async sslReturnGet(@Req() req: Request, @Res() res: Response) {
    return res.redirect(302, await this.tenantPayments.sslReturnRedirect((req.query ?? {}) as Record<string, any>));
  }

  @Public() @Get("bkash/callback")
  async bkashCallback(@Req() req: Request, @Res() res: Response) {
    const url = await this.tenantPayments.handleBkashCallback((req.query ?? {}) as Record<string, any>);
    return res.redirect(302, url);
  }
}
