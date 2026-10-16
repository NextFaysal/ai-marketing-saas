import {
  BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, UseGuards,
} from "@nestjs/common";
import { PurchasingService } from "./purchasing.service";
import { InventoryIntelligenceService } from "./inventory-intelligence.service";
import {
  CreatePurchaseOrderDto, CreateSupplierDto, ReceivePurchaseOrderDto,
  UpdateInventorySettingsDto, UpdatePurchaseOrderDto, UpdateSupplierDto,
} from "./purchasing.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC20 — Purchasing & Suppliers staff API. Same guard stack as the
 * fulfillment controller: TenantGuard + RolesGuard at class level,
 * @PermissionArea("orders"), writes restricted to WRITE_ROLES. */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class PurchasingController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly intelligence: InventoryIntelligenceService,
  ) {}

  // ---- Suppliers ----
  @Get("commerce/suppliers")
  listSuppliers(@Param("organizationId") orgId: string) {
    return this.purchasing.listSuppliers(orgId);
  }

  @Post("commerce/suppliers") @Roles(...WRITE_ROLES)
  createSupplier(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSupplierDto) {
    return this.purchasing.createSupplier(orgId, user.userId, dto);
  }

  @Patch("commerce/suppliers/:supplierId") @Roles(...WRITE_ROLES)
  updateSupplier(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("supplierId") supplierId: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.purchasing.updateSupplier(orgId, user.userId, supplierId, dto);
  }

  @Delete("commerce/suppliers/:supplierId") @Roles(...WRITE_ROLES)
  deleteSupplier(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("supplierId") supplierId: string,
  ) {
    return this.purchasing.deleteSupplier(orgId, user.userId, supplierId);
  }

  // ---- Purchase orders ----
  @Post("commerce/purchase-orders") @Roles(...WRITE_ROLES)
  createPurchaseOrder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchasing.createPurchaseOrder(orgId, user.userId, dto);
  }

  @Get("commerce/purchase-orders")
  listPurchaseOrders(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.purchasing.listPurchaseOrders(orgId, status || undefined);
  }

  @Get("commerce/purchase-orders/:poId")
  getPurchaseOrder(@Param("organizationId") orgId: string, @Param("poId") poId: string) {
    return this.purchasing.getPurchaseOrder(orgId, poId);
  }

  @Patch("commerce/purchase-orders/:poId") @Roles(...WRITE_ROLES)
  updatePurchaseOrder(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("poId") poId: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchasing.updatePurchaseOrder(orgId, user.userId, poId, dto);
  }

  @Post("commerce/purchase-orders/:poId/receive") @Roles(...WRITE_ROLES)
  receive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("poId") poId: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchasing.receive(orgId, user.userId, poId, dto);
  }

  // ---- Inventory: reorder suggestions ----
  // EC33: no mode (or mode=simple) keeps the ORIGINAL threshold
  // response byte-identical via PurchasingService; mode=velocity
  // routes to the intelligence service; anything else is a 400.
  @Get("inventory/reorder-suggestions")
  reorderSuggestions(@Param("organizationId") orgId: string, @Query("mode") mode?: string) {
    if (mode === undefined || mode === "" || mode === "simple") {
      return this.purchasing.reorderSuggestions(orgId);
    }
    if (mode === "velocity") {
      return this.intelligence.reorderSuggestionsV2(orgId, "velocity");
    }
    throw new BadRequestException("mode অবশ্যই simple বা velocity হতে হবে");
  }

  // ---- EC33: Inventory intelligence ----
  @Get("inventory/velocity")
  velocity(@Param("organizationId") orgId: string, @Query("windowDays") windowDays?: string) {
    return this.intelligence.velocity(orgId, windowDays === undefined || windowDays === "" ? 30 : Number(windowDays));
  }

  @Get("inventory/dead-stock")
  deadStock(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.intelligence.deadStock(orgId, days === undefined || days === "" ? 90 : Number(days));
  }

  @Get("inventory/dead-stock.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=dead-stock.csv")
  deadStockCsv(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.intelligence.deadStockCsv(orgId, days === undefined || days === "" ? 90 : Number(days));
  }

  @Get("inventory/valuation")
  valuation(@Param("organizationId") orgId: string) {
    return this.intelligence.valuation(orgId);
  }

  @Get("inventory/settings")
  getInventorySettings(@Param("organizationId") orgId: string) {
    return this.intelligence.getSettings(orgId);
  }

  @Put("inventory/settings") @Roles(...WRITE_ROLES)
  updateInventorySettings(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdateInventorySettingsDto,
  ) {
    return this.intelligence.updateSettings(orgId, user.userId, dto);
  }

  /** GB2 (GC7): per-row on-hand / reserved / available. */
  @Get("inventory/availability")
  inventoryAvailability(@Param("organizationId") orgId: string) {
    return this.intelligence.availability(orgId);
  }

  /** GB2 (GC7): damaged / lost / expired report. */
  @Get("inventory/damage-report")
  inventoryDamageReport(@Param("organizationId") orgId: string, @Query() q: { from?: string; to?: string }) {
    return this.intelligence.damageReport(orgId, q.from, q.to);
  }
}
