import { Type } from "class-transformer";
import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from "class-validator";

/** EC21 — Warehouse & Stock Ops DTOs. Quantities are plain
 * integers (no money here); Bengali-first validation messages
 * live in the service, class-validator only shapes the payload.
 *
 * AB3 (AX4): warehouses gain priority + serviceDistricts, and
 * the stock-transfer DTOs land here (the transfer service lives
 * in this module). serviceDistricts entries are validated in
 * the SERVICE against the BD district vocabulary
 * (orders/bd-address-data) — class-validator only enforces the
 * array-of-strings shape. */

export class CreateWarehouseDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  /** AB3: allocation order — lower number served first. */
  @IsOptional() @IsInt() @Min(0) priority?: number;
  /** AB3: BD district names this warehouse serves first. */
  @IsOptional() @IsArray() @IsString({ each: true }) serviceDistricts?: string[] | null;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) serviceDistricts?: string[] | null;
}

export class CreateBinDto {
  @IsString() @MaxLength(80) code!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class UpdateBinDto {
  @IsOptional() @IsString() @MaxLength(80) code?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class CreateBinAssignmentDto {
  @IsString() warehouseId!: string;
  @IsString() binLocationId!: string;
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string | null;
}

export class CreateStockCountDto {
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() binLocationId?: string | null;
}

export class SetCountedQtyDto {
  @IsInt() @Min(0) countedQty!: number;
}

// ---------- AB3: warehouse stock transfers ----------

export class StockTransferLineDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string | null;
  @IsInt() @Min(1) qtySent!: number;
}

export class CreateStockTransferDto {
  @IsString() fromBinId!: string;
  @IsString() toBinId!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => StockTransferLineDto)
  lines!: StockTransferLineDto[];
}

export class ReceiveStockTransferLineDto {
  @IsString() lineId!: string;
  @IsInt() @Min(0) qtyReceived!: number;
}

export class ReceiveStockTransferDto {
  /** Lines not listed default to their full qtySent. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiveStockTransferLineDto)
  lines?: ReceiveStockTransferLineDto[];
}

// ---------- AB3: staff re-allocation ----------

export class ReallocateOrderDto {
  @IsString() warehouseId!: string;
}
