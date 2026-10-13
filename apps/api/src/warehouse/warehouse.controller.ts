import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { WarehouseService } from "./warehouse.service";
import {
  CreateBinAssignmentDto, CreateBinDto, CreateStockCountDto,
  CreateWarehouseDto, SetCountedQtyDto, UpdateBinDto, UpdateWarehouseDto,
} from "./warehouse.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC21 — Warehouse & Stock Ops (staff). Same guard stack and
 * full-subpath style as the Fulfillment controller. */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

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
}
