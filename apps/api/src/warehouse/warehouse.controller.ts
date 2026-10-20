import { Body, Controller, Delete, Get, Header, Optional, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { WarehouseService } from "./warehouse.service";
import { StockTransfersService } from "./stock-transfers.service";
import { InventoryService } from "../inventory/inventory.service";
import {
  CreateBinAssignmentDto, CreateBinDto, CreateStockCountDto,
  CreateStockTransferDto, CreateWarehouseDto, ReallocateOrderDto,
  ReceiveStockTransferDto, SetCountedQtyDto, UpdateBinDto, UpdateWarehouseDto,
} from "./warehouse.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { badRequest } from "../i18n/api-exception";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC21 — Warehouse & Stock Ops (staff). Same guard stack and
 * full-subpath style as the Fulfillment controller.
 * AB3 (AX4): stock balances / stock-by-location reads, warehouse
 * stock transfers, and the staff order re-allocation endpoint
 * join this controller (the warehouse module already injects
 * InventoryService, so reallocate needs no new module edge). */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class WarehouseController {
  constructor(
    private readonly warehouse: WarehouseService,
    // Optional so manual constructions in older specs keep
    // working; WarehouseModule provides both.
    @Optional() private readonly transfers?: StockTransfersService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  private requireTransfers(): StockTransfersService {
    if (!this.transfers) throw badRequest("warehouse.theTransferFacilityIsNotAvailable");
    return this.transfers;
  }

  // ---- Warehouses ----
  @Get("commerce/warehouses")
  listWarehouses(@Param("organizationId") orgId: string) {
    return this.warehouse.listWarehouses(orgId);
  }

  @Post("commerce/warehouses") @Roles(...WRITE_ROLES)
  createWarehouse(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateWarehouseDto) {
    return this.warehouse.createWarehouse(orgId, user.userId, dto);
  }

  @Patch("commerce/warehouses/:warehouseId") @Roles(...WRITE_ROLES)
  updateWarehouse(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("warehouseId") warehouseId: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehouse.updateWarehouse(orgId, user.userId, warehouseId, dto);
  }

  @Delete("commerce/warehouses/:warehouseId") @Roles(...WRITE_ROLES)
  deleteWarehouse(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("warehouseId") warehouseId: string) {
    return this.warehouse.deleteWarehouse(orgId, user.userId, warehouseId);
  }

  // ---- Bins ----
  @Get("commerce/warehouses/:warehouseId/bins")
  listBins(@Param("organizationId") orgId: string, @Param("warehouseId") warehouseId: string) {
    return this.warehouse.listBins(orgId, warehouseId);
  }

  @Post("commerce/warehouses/:warehouseId/bins") @Roles(...WRITE_ROLES)
  createBin(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("warehouseId") warehouseId: string, @Body() dto: CreateBinDto) {
    return this.warehouse.createBin(orgId, user.userId, warehouseId, dto);
  }

  @Patch("commerce/warehouses/:warehouseId/bins/:binId") @Roles(...WRITE_ROLES)
  updateBin(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("warehouseId") warehouseId: string, @Param("binId") binId: string, @Body() dto: UpdateBinDto) {
    return this.warehouse.updateBin(orgId, user.userId, warehouseId, binId, dto);
  }

  @Delete("commerce/warehouses/:warehouseId/bins/:binId") @Roles(...WRITE_ROLES)
  deleteBin(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("warehouseId") warehouseId: string, @Param("binId") binId: string) {
    return this.warehouse.deleteBin(orgId, user.userId, warehouseId, binId);
  }

  // ---- Bin assignments ----
  @Get("commerce/bin-assignments")
  listAssignments(
    @Param("organizationId") orgId: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("binLocationId") binLocationId?: string,
    @Query("productId") productId?: string,
  ) {
    return this.warehouse.listAssignments(orgId, {
      warehouseId: warehouseId || undefined,
      binLocationId: binLocationId || undefined,
      productId: productId || undefined,
    });
  }

  @Post("commerce/bin-assignments") @Roles(...WRITE_ROLES)
  upsertAssignment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateBinAssignmentDto) {
    return this.warehouse.upsertAssignment(orgId, user.userId, dto);
  }

  @Delete("commerce/bin-assignments/:assignmentId") @Roles(...WRITE_ROLES)
  deleteAssignment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("assignmentId") assignmentId: string) {
    return this.warehouse.deleteAssignment(orgId, user.userId, assignmentId);
  }

  // ---- Stock counts ----
  @Post("commerce/stock-counts") @Roles(...WRITE_ROLES)
  createStockCount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateStockCountDto) {
    return this.warehouse.createStockCount(orgId, user.userId, dto);
  }

  @Get("commerce/stock-counts")
  listStockCounts(@Param("organizationId") orgId: string) {
    return this.warehouse.listStockCounts(orgId);
  }

  @Get("commerce/stock-counts/:sessionId")
  getStockCount(@Param("organizationId") orgId: string, @Param("sessionId") sessionId: string) {
    return this.warehouse.getStockCount(orgId, sessionId);
  }

  @Patch("commerce/stock-counts/:sessionId/lines/:lineId") @Roles(...WRITE_ROLES)
  setCountedQty(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("sessionId") sessionId: string, @Param("lineId") lineId: string, @Body() dto: SetCountedQtyDto) {
    return this.warehouse.setCountedQty(orgId, user.userId, sessionId, lineId, dto.countedQty);
  }

  @Post("commerce/stock-counts/:sessionId/close") @Roles(...WRITE_ROLES)
  closeStockCount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("sessionId") sessionId: string) {
    return this.warehouse.closeStockCount(orgId, user.userId, sessionId);
  }

  // ---- AB3: stock balances + stock-by-location ----

  @Get("commerce/stock-balances")
  listStockBalances(@Param("organizationId") orgId: string) {
    return this.warehouse.listStockBalances(orgId);
  }

  @Get("commerce/stock-by-location")
  stockByLocation(@Param("organizationId") orgId: string) {
    return this.warehouse.stockByLocation(orgId);
  }

  @Get("commerce/stock-by-location.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=stock-by-location.csv")
  stockByLocationCsv(@Param("organizationId") orgId: string) {
    return this.warehouse.stockByLocationCsv(orgId);
  }

  // ---- AB3: warehouse stock transfers ----

  @Post("commerce/stock-transfers") @Roles(...WRITE_ROLES)
  createTransfer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateStockTransferDto) {
    return this.requireTransfers().createTransfer(orgId, user.userId, dto);
  }

  @Get("commerce/stock-transfers")
  listTransfers(@Param("organizationId") orgId: string) {
    return this.requireTransfers().listTransfers(orgId);
  }

  @Get("commerce/stock-transfers/:transferId")
  getTransfer(@Param("organizationId") orgId: string, @Param("transferId") transferId: string) {
    return this.requireTransfers().getTransfer(orgId, transferId);
  }

  @Post("commerce/stock-transfers/:transferId/dispatch") @Roles(...WRITE_ROLES)
  dispatchTransfer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("transferId") transferId: string) {
    return this.requireTransfers().dispatchTransfer(orgId, user.userId, transferId);
  }

  @Post("commerce/stock-transfers/:transferId/receive") @Roles(...WRITE_ROLES)
  receiveTransfer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("transferId") transferId: string, @Body() dto: ReceiveStockTransferDto) {
    return this.requireTransfers().receiveTransfer(orgId, user.userId, transferId, dto);
  }

  @Post("commerce/stock-transfers/:transferId/cancel") @Roles(...WRITE_ROLES)
  cancelTransfer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("transferId") transferId: string) {
    return this.requireTransfers().cancelTransfer(orgId, user.userId, transferId);
  }

  // ---- AB3: staff re-allocation (design §5.3) ----

  @Post("commerce/orders/:orderId/reallocate") @Roles(...WRITE_ROLES)
  async reallocateOrder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") orderId: string, @Body() dto: ReallocateOrderDto) {
    if (!this.inventory) throw badRequest("warehouse.theInventoryServiceIsNotAvailable");
    const result: any = await this.inventory.reallocateOrderBins(orgId, orderId, dto.warehouseId, user.userId);
    // Label the returned allocation rows like the order detail's
    // allocations[] (warehouseName/binCode) for a consistent API.
    if (result && Array.isArray(result.allocations)) {
      result.allocations = await this.warehouse.labelAllocationRows(orgId, result.allocations);
    }
    return result;
  }
}
