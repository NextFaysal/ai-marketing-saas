import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/** EC21 — Warehouse & Stock Ops DTOs. Quantities are plain
 * integers (no money here); Bengali-first validation messages
 * live in the service, class-validator only shapes the payload. */

export class CreateWarehouseDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
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
