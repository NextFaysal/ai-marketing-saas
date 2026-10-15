import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrderInsightsService } from "./order-insights.service";
import { FraudShieldService } from "./fraud-shield.service";
import { OrderSurgeryService } from "./order-surgery.service";
import { parseBdAddress } from "./bd-address";
import { AdvanceVerificationDto, AssignOrderDto, CodCallDto, CreateBlockedPhoneDto, CreateManualOrderDto, CreateOrderCommentDto, CreateSavedViewDto, CreateStoreDraftDto, EditOrderItemsDto, HoldOrderDto, MergeOrdersDto, ParseAddressDto, SetOrderTagsDto, SplitOrderDto, StoreNoteDto, UpdateFraudSettingsDto, UpdateOrderDto } from "./orders.dto";
import { AssignAgentDto, AssignOrderPatchDto, BulkAssignAgentDto, MergeDuplicateOrdersDto, StaffScoreboardQueryDto } from "./orders.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly insights: OrderInsightsService,
    private readonly fraud: FraudShieldService,
    private readonly surgery: OrderSurgeryService,
  ) {}

  /** Feature 5: Staff Performance & Sales Attribution Scoreboard */
  @Get("scoreboard")
  scoreboard(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("commission") commission?: string,
  ) {
    const commissionNum = commission ? parseFloat(commission) : undefined;
    return this.orders.getStaffScoreboard(orgId, {
      from,
      to,
      commissionPerDeliveryBdt: isNaN(commissionNum!) ? undefined : commissionNum,
    });
  }

  /** Feature 5: Bulk assign orders to a staff agent */
  @Post("bulk-assign")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  bulkAssign(
    @Param("organizationId") orgId: string,
    @Body() dto: BulkAssignAgentDto,
  ) {
    return this.orders.bulkAssignAgent(orgId, dto.orderIds, dto.agentId);
  }

  /** Milestone 65: record a phone/counter order manually. */
  @Post() @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createManual(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateManualOrderDto) {
    return this.orders.createManual(orgId, user.userId, dto);
  }

  @Get("stats")
  stats(@Param("organizationId") orgId: string) { return this.orders.stats(orgId); }

  // ---- ON1 literals BEFORE ":orderId" so they win routing ----

  @Get("queues")
  queues(@Param("organizationId") orgId: string) { return this.orders.queueCounts(orgId); }

  @Get("feed")
  feed(@Param("organizationId") orgId: string, @Query("since") since?: string) {
    return this.orders.feed(orgId, since);
  }

  @Get("saved-views")
  listSavedViews(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.orders.listSavedViews(orgId, user.userId);
  }

  @Post("saved-views") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSavedViewDto) {
    return this.orders.createSavedView(orgId, user.userId, dto);
  }

  @Delete("saved-views/:viewId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("viewId") viewId: string) {
    return this.orders.deleteSavedView(orgId, user.userId, viewId);
  }

  // ---- ON4 literals BEFORE ":orderId" ----

  @Get("fraud-settings")
  fraudSettings(@Param("organizationId") orgId: string) { return this.fraud.getSettings(orgId); }

  @Put("fraud-settings") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateFraudSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateFraudSettingsDto) {
    return this.fraud.updateSettings(orgId, user.userId, dto);
  }

  @Get("blocked-phones")
  blockedPhones(@Param("organizationId") orgId: string) { return this.fraud.blockList(orgId); }

  @Post("blocked-phones") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  addBlockedPhone(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateBlockedPhoneDto) {
    return this.fraud.blockAdd(orgId, user.userId, dto);
  }

  @Delete("blocked-phones/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  removeBlockedPhone(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.fraud.blockRemove(orgId, user.userId, id);
  }

  /** ON11: parse a free-text address into district/thana. */
  @Post("parse-address")
  parseAddress(@Body() dto: ParseAddressDto) {
    return parseBdAddress(dto?.text ?? "");
  }

  /** Feature 2: find duplicate orders placed by the same customer/phone. */
  @Get("duplicates")
  duplicates(@Param("organizationId") orgId: string) {
    return this.orders.findDuplicates(orgId);
  }

  /** Feature 2: merge multiple duplicate orders into one primary order. */
  @Post("merge")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  mergeDuplicates(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: MergeDuplicateOrdersDto,
  ) {
    return this.orders.mergeOrders(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string, @Query() q: {
    status?: string; cod?: string; page?: string; pageSize?: string; practice?: string;
    queue?: string; dateFrom?: string; dateTo?: string; district?: string; provider?: string;
    source?: string; paymentState?: string; minTotal?: string; maxTotal?: string;
    assigneeId?: string; tag?: string; search?: string; sort?: string; riskBand?: string;
  }) {
    return this.orders.list(orgId, {
      status: q.status, isCod: q.cod === undefined ? undefined : q.cod === "true",
      page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      includePractice: q.practice === "1" || q.practice === "true",
      queue: q.queue, dateFrom: q.dateFrom, dateTo: q.dateTo, district: q.district,
      provider: q.provider, source: q.source, paymentState: q.paymentState,
      minTotal: q.minTotal, maxTotal: q.maxTotal, assigneeId: q.assigneeId,
      tag: q.tag, search: q.search, sort: q.sort, riskBand: q.riskBand,
    });
  }

  @Get("export") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=orders-export.csv")
  exportCsv(@Param("organizationId") orgId: string, @Query() q: { status?: string; cod?: string; from?: string; to?: string }) {
    return this.orders.exportCsv(orgId, {
      status: q.status, isCod: q.cod === undefined ? undefined : q.cod === "true",
      from: q.from, to: q.to,
    });
  }

  @Get(":orderId/risk")
  risk(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.riskForOrder(orgId, id); }

  @Get(":orderId/timeline")
  timeline(@Param("organizationId") orgId: string, @Param("orderId") id: string) {
    return this.insights.timeline(orgId, id);
  }

  @Get(":orderId/customer-360")
  customer360(@Param("organizationId") orgId: string, @Param("orderId") id: string) {
    return this.insights.customer360(orgId, id);
  }

  @Get(":orderId/comments")
  listComments(@Param("organizationId") orgId: string, @Param("orderId") id: string) {
    return this.insights.listComments(orgId, id);
  }

  @Post(":orderId/comments") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createComment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: CreateOrderCommentDto) {
    return this.insights.createComment(orgId, user.userId, id, dto.body);
  }

  @Delete(":orderId/comments/:commentId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteComment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Param("commentId") commentId: string) {
    return this.insights.deleteComment(orgId, user.userId, id, commentId);
  }

  @Get(":orderId")
  getOne(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.getOne(orgId, id); }

  // ---- ON4 per-order actions ----

  @Post(":orderId/reassess") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  reassess(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string) {
    return this.fraud.reassess(orgId, user.userId, id);
  }

  @Post(":orderId/hold") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  hold(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: HoldOrderDto) {
    return this.fraud.hold(orgId, user.userId, id, dto?.reason);
  }

  @Post(":orderId/release") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  release(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string) {
    return this.fraud.release(orgId, user.userId, id);
  }

  @Post(":orderId/cod-call") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  codCall(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: CodCallDto) {
    return this.fraud.recordCodCall(orgId, user.userId, id, dto?.outcome);
  }

  @Post(":orderId/tags") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setTags(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: SetOrderTagsDto) {
    return this.orders.setTags(orgId, user.userId, id, dto.tags);
  }

  @Patch(":orderId/assign") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  assign(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: AssignOrderPatchDto) {
    // Integration-6 union: ON1 assignee assignment and the enterprise
    // staff-attribution assignment share this route; an explicit
    // agentId in the body selects staff attribution (agentId +
    // commission), otherwise the ON1 assignee path runs as before.
    if (typeof dto.agentId === "string" && dto.agentId) {
      return this.orders.assignAgent(orgId, id, dto.agentId, dto.commissionMinor);
    }
    return this.orders.assignOrder(orgId, user.userId, id, dto.assigneeId ?? null);
  }

  @Post(":orderId/advance-verification") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  recordAdvanceVerification(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: AdvanceVerificationDto) {
    return this.orders.recordAdvanceVerification(orgId, user.userId, id, dto);
  }

  @Post(":orderId/create-store-draft") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  createStoreDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: CreateStoreDraftDto) {
    return this.orders.createStoreDraft(orgId, user.userId, id, dto?.storeId);
  }

  @Post(":orderId/store-note") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  pushStoreNote(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: StoreNoteDto) {
    return this.orders.pushStoreNote(orgId, user.userId, id, dto.note);
  }

  @Patch(":orderId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.updateOrder(orgId, user.userId, id, dto);
  }

  // ---- ON3 order surgery (items / split / merge) ----
  // Surgery writes are OWNER/ADMIN/MARKETING_MANAGER only
  // (precedent: create-store-draft). ":survivorId/merge" is
  // param-first — it collides with no literal route.

  @Patch(":orderId/items") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  editItems(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: EditOrderItemsDto) {
    return this.surgery.editItems(orgId, user.userId, id, dto);
  }

  @Post(":orderId/items/preview") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  previewItems(@Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: EditOrderItemsDto) {
    return this.surgery.previewItems(orgId, id, dto);
  }

  @Post(":orderId/split") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  split(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: SplitOrderDto) {
    return this.surgery.split(orgId, user.userId, id, dto);
  }

  @Post(":survivorId/merge") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  merge(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("survivorId") survivorId: string, @Body() dto: MergeOrdersDto) {
    return this.surgery.merge(orgId, user.userId, survivorId, dto);
  }

}
