import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { DropshipService } from "./dropship.service";
import { SupplierPortalService } from "./supplier-portal.service";
import {
  CreateDropshipListingDto, InviteDropshipDto, ProcessDropshipOrderDto,
  RespondDropshipDto, SetDropshipOfferDto, SetListingActiveDto,
} from "./dropship.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF12 (FB4) — staff API: supplier portal-link management (on
 * the existing purchasing/suppliers URL surface) + the dropship
 * surface. Agreement responses (accept/decline) are OWNER/ADMIN
 * only per the brief; invites and day-to-day dropship work ride
 * the purchasing WRITE_ROLES set. TenantGuard scopes the caller
 * to :organizationId — every cross-org effect beyond that is
 * mediated by DropshipService's agreement gate, never by a
 * caller-supplied org id.
 */
const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;
const DECIDE_ROLES = ["OWNER", "ADMIN"] as const;

@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class DropshipController {
  constructor(
    private readonly dropship: DropshipService,
    private readonly portal: SupplierPortalService,
  ) {}

  // ---- Supplier portal links (purchasing surface) ----

  @Post("commerce/suppliers/:supplierId/portal-link") @Roles(...WRITE_ROLES)
  issuePortalLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("supplierId") supplierId: string) {
    return this.portal.issueLink(orgId, user.userId, supplierId);
  }

  @Post("commerce/suppliers/:supplierId/portal-link/revoke") @Roles(...WRITE_ROLES)
  revokePortalLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("supplierId") supplierId: string) {
    return this.portal.revokeLink(orgId, user.userId, supplierId);
  }

  @Get("commerce/suppliers/:supplierId/portal-link")
  portalLinkStatus(@Param("organizationId") orgId: string, @Param("supplierId") supplierId: string) {
    return this.portal.linkStatus(orgId, supplierId);
  }

  // ---- Dropship agreements ----

  @Post("dropship/invite") @Roles(...WRITE_ROLES)
  invite(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: InviteDropshipDto) {
    return this.dropship.invite(orgId, user.userId, dto);
  }

  @Get("dropship/agreements")
  listAgreements(@Param("organizationId") orgId: string) {
    return this.dropship.listAgreements(orgId);
  }

  @Post("dropship/agreements/:agreementId/respond") @Roles(...DECIDE_ROLES)
  respond(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("agreementId") agreementId: string,
    @Body() dto: RespondDropshipDto,
  ) {
    return this.dropship.respond(orgId, user.userId, agreementId, Boolean(dto.accept));
  }

  @Post("dropship/agreements/:agreementId/revoke") @Roles(...WRITE_ROLES)
  revoke(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("agreementId") agreementId: string) {
    return this.dropship.revoke(orgId, user.userId, agreementId);
  }

  // ---- Offers + listings ----

  @Post("dropship/agreements/:agreementId/offers") @Roles(...WRITE_ROLES)
  setOffer(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("agreementId") agreementId: string,
    @Body() dto: SetDropshipOfferDto,
  ) {
    return this.dropship.setOffer(orgId, user.userId, agreementId, dto);
  }

  @Get("dropship/agreements/:agreementId/offers")
  listOffers(@Param("organizationId") orgId: string, @Param("agreementId") agreementId: string) {
    return this.dropship.listOffers(orgId, agreementId);
  }

  @Post("dropship/listings") @Roles(...WRITE_ROLES)
  createListing(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateDropshipListingDto) {
    return this.dropship.createListing(orgId, user.userId, dto);
  }

  @Get("dropship/listings")
  listListings(@Param("organizationId") orgId: string) {
    return this.dropship.listListings(orgId);
  }

  @Patch("dropship/listings/:listingId/active") @Roles(...WRITE_ROLES)
  setListingActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("listingId") listingId: string,
    @Body() dto: SetListingActiveDto,
  ) {
    return this.dropship.setListingActive(orgId, user.userId, listingId, Boolean(dto.active));
  }

  // ---- Dropship orders + ledger ----

  @Post("dropship/orders/process") @Roles(...WRITE_ROLES)
  processOrder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ProcessDropshipOrderDto) {
    return this.dropship.processSellerOrder(orgId, user.userId, dto.sellerOrderId);
  }

  @Get("dropship/orders")
  listOrders(@Param("organizationId") orgId: string) {
    return this.dropship.listDropshipOrders(orgId);
  }

  @Post("dropship/orders/:linkId/cancel") @Roles(...WRITE_ROLES)
  cancelFulfilment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("linkId") linkId: string) {
    return this.dropship.cancelFulfilment(orgId, user.userId, linkId);
  }

  @Get("dropship/ledger")
  listLedger(@Param("organizationId") orgId: string) {
    return this.dropship.listLedger(orgId);
  }
}
