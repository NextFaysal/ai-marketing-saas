import { Type } from "class-transformer";
import {
  IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString,
  Max, MaxLength, Min, ValidateNested,
} from "class-validator";

/** Milestone 65: a manually recorded order (phone / counter /
 * messenger orders taken outside the inbox). Items are free-form
 * lines — manual orders are often not catalog products — and all
 * money arrives as integer minor units; the server computes the
 * totals. */
export class ManualOrderItemDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
  @IsInt() @Min(0) unitPriceMinor!: number;
}

export class CreateManualOrderDto {
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  @IsOptional() @IsEmail() @MaxLength(200) customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  /** The shop's own order reference — re-submitting the same
   * reference updates the order instead of duplicating it. */
  @IsOptional() @IsString() @MaxLength(80) externalRef?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ManualOrderItemDto)
  items!: ManualOrderItemDto[];
  @IsOptional() @IsInt() @Min(0) shippingMinor?: number;
  @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  @IsOptional() @IsBoolean() isCod?: boolean;
  @IsOptional() @IsIn(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"])
  status?: string;
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsString() @MaxLength(40) placedAt?: string;
}
