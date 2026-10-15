import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { FulfillmentService } from "./fulfillment.service";
import { ReturnsService } from "./returns.service";
import {
  BookReturnCourierDto, CreateFulfillmentDto, DecideReturnDto, MarkReceivedDto,
  SubmitReturnDto, UpdateFulfillmentDto,
} from "./fulfillment.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class FulfillmentController {
  constructor(
    private readonly fulfillments: FulfillmentService,
    private readonly returns: ReturnsService,
  ) {}

  // ---- Fulfillments ----
  @Post("orders/:orderId/fulfillments") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") orderId: string, @Body() dto: CreateFulfillmentDto) {
    return this.fulfillments.create(orgId, user.userId, orderId, dto);
  }

  @Get("orders/:orderId/fulfillments")
  listForOrder(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.fulfillments.listForOrder(orgId, orderId);
  }

  /** Declared before "fulfillments/:fulfillmentId" so the literals win. */
  @Get("fulfillments/board")
  board(@Param("organizationId") orgId: string) { return this.fulfillments.board(orgId); }

  @Get("fulfillments/manifest")
  manifest(@Param("organizationId") orgId: string, @Query("courier") courier?: string, @Query("date") date?: string) {
    return this.fulfillments.manifest(orgId, courier ?? "", date);
  }

  @Patch("fulfillments/:fulfillmentId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("fulfillmentId") id: string, @Body() dto: UpdateFulfillmentDto) {
    return this.fulfillments.update(orgId, user.userId, id, dto);
  }

  // ---- Returns (staff) ----
  @Post("orders/:orderId/return-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createReturnLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.returns.createLink(orgId, user.userId, orderId);
  }

  @Get("returns")
  listReturns(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.returns.list(orgId, status || undefined);
  }

  @Get("returns/:returnId")
  async getReturn(@Param("organizationId") orgId: string, @Param("returnId") id: string) {
    const rr = await this.returns.loadReturn(orgId, id);
    return { ...rr, refundAmountMinor: rr.refundAmountMinor != null ? String(rr.refundAmountMinor) : null };
  }

  @Post("returns/:returnId/decide") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  decide(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("returnId") id: string, @Body() dto: DecideReturnDto) {
    return this.returns.decide(orgId, user.userId, id, dto);
  }

  @Post("returns/:returnId/book-return") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  bookReturn(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("returnId") id: string, @Body() dto: BookReturnCourierDto) {
    return this.returns.bookReturnCourier(orgId, user.userId, id, dto);
  }

  @Post("returns/:returnId/received") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  received(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("returnId") id: string, @Body() dto: MarkReceivedDto) {
    return this.returns.markReceived(orgId, user.userId, id, dto);
  }

  @Post("returns/:returnId/complete") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  complete(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("returnId") id: string) {
    return this.returns.complete(orgId, user.userId, id);
  }
}

/** EC9 public return page API — the unguessable token is the only
 *  credential (same pattern as the public review / tracking pages). */
@Controller("returns")
export class PublicReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get(":token")
  view(@Param("token") token: string) { return this.returns.publicView(token); }

  @Post(":token")
  submit(@Param("token") token: string, @Body() dto: SubmitReturnDto) {
    return this.returns.publicSubmit(token, dto);
  }
}
