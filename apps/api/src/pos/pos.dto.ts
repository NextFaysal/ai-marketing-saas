import { Type } from "class-transformer";
import {
  IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from "class-validator";

/**
 * EC34 — POS (counter / quick-sale) DTOs.
 *
 * IMPORTANT: there are deliberately NO price fields anywhere in
 * these DTOs. A counter sale must never trust a client-sent
 * price — PosService resolves every unit price server-side from
 * Product.priceMinor / ProductVariant.priceMinor, runs the ONE
 * PromotionsService.evaluateCheckout pricing path, and only then
 * places the order. Extra price-ish fields a client sends are
 * ignored by construction (the service never reads them).
 */
export class PosSaleItemDto {
  @IsString() @MaxLength(64) productId!: string;
  @IsOptional() @IsString() @MaxLength(64) variantId?: string;
  @IsInt() @Min(1) @Max(9999) quantity!: number;
}

export class PosPaymentDto {
  /** "paid" = money taken at the counter now; "due" = বাকি/খাতা
   * (nothing collected — the full total stays as the order due). */
  @IsIn(["paid", "due"]) mode!: "paid" | "due";
  @IsOptional() @IsIn(["cash", "bkash", "nagad", "rocket", "card", "bank", "other"]) method?: string;
  /** Gateway TrxID / receipt reference for a paid sale. When
   * present it goes through the EC19 duplicate-approved-TrxID
   * guard before anything is written. */
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class CreatePosSaleDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PosSaleItemDto)
  items!: PosSaleItemDto[];
  /** Optional buyer phone — when present the order's customer is
   * found-or-created by phone (the upsert's source-scoped
   * externalId). When absent the sale is a counter walk-in (see
   * PosService for the shared walk-in customer record). */
  @IsOptional() @IsString() @MaxLength(40) customerPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  @IsOptional() @IsString() @MaxLength(80) couponCode?: string;
  @ValidateNested() @Type(() => PosPaymentDto) payment!: PosPaymentDto;
}
