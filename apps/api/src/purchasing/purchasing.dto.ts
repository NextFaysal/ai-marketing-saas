import { Type } from "class-transformer";
import {
  IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested,
} from "class-validator";

/** EC20: suppliers. `name` is required; the service enforces the
 * non-empty rule with a Bengali 400 (class-validator messages are
 * not user-facing in this codebase's style). */
export class CreateSupplierDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(200) email?: string | null;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class PurchaseOrderItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() @MaxLength(120) sku?: string;
  @IsInt() qtyOrdered!: number;
  /** BigInt minor units as a string (money crosses the wire as strings). */
  @IsString() unitCostMinor!: string;
}

export class CreatePurchaseOrderDto {
  @IsString() supplierId!: string;
  @IsOptional() @IsString() expectedDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsString() expectedDate?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsOptional() @IsIn(["draft", "ordered", "partially_received", "received", "cancelled"]) status?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[];
}

export class ReceiveItemDto {
  @IsString() itemId!: string;
  @IsInt() qty!: number;
  /** Optional per-line cost override (string minor units); when
   * absent the PO line's ordered unit cost is used. */
  @IsOptional() @IsString() unitCostMinor?: string;
}

export class ReceivePurchaseOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiveItemDto)
  items!: ReceiveItemDto[];
}

/** EC33: inventory-intelligence settings. The 1..180 range is
 * enforced by the service with a Bengali 400 (same discipline as
 * the tax settings DTO); the DTO only pins the integer type. */
export class UpdateInventorySettingsDto {
  // GB2 (GC7): partial — the settings row now also carries the
  // backorder switch and the cart-reservation window; any subset
  // may be sent (the service validates ranges + audits the
  // changed field names only).
  @IsOptional() @IsInt() leadTimeDays?: number;
  @IsOptional() @IsBoolean() allowBackorder?: boolean;
  @IsOptional() @IsInt() reserveMinutes?: number;
}
