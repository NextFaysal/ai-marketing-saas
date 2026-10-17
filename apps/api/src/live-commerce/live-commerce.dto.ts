import { Type } from "class-transformer";
import {
  IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from "class-validator";

/**
 * NF1 (FB1) — Live Commerce DTOs. Order creation reuses the
 * EXISTING manual-order item shape (name/sku/quantity/
 * unitPriceMinor — see orders.dto ManualOrderItemDto): a
 * comment→order call supplies catalog-resolved lines exactly
 * like a staff manual order does; LiveCommerceService forwards
 * them to OrdersService.createManual untouched.
 */
export class CreateLiveSessionDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsIn(["meta", "manual"]) source?: string;
  /** Required when source = "meta" (validated in the service so
   * the error is a merchant-readable Bengali 400, not a bare
   * validation list). */
  @IsOptional() @IsString() @MaxLength(64) socialAccountId?: string;
  @IsOptional() @IsString() @MaxLength(120) externalLiveVideoId?: string;
}

export class SetLiveSessionProductsDto {
  /** Replace semantics: the full pinned list, in display order. */
  @IsArray() @IsString({ each: true }) productIds!: string[];
}

export class ManualCommentDto {
  @IsString() @MaxLength(200) commenterName!: string;
  @IsOptional() @IsString() @MaxLength(120) commenterExternalId?: string;
  @IsString() @MaxLength(2000) message!: string;
  @IsOptional() @IsString() @MaxLength(40) commentedAt?: string;
  /** Optional: when staff import carries the platform comment
   * id, the (session, externalCommentId) unique dedupes it. */
  @IsOptional() @IsString() @MaxLength(120) externalCommentId?: string;
}

export class ImportLiveCommentsDto {
  /** Single comment (commenterName + message at top level) OR a
   * batch — when `comments` is present it wins. */
  @IsOptional() @IsString() @MaxLength(200) commenterName?: string;
  @IsOptional() @IsString() @MaxLength(120) commenterExternalId?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() @MaxLength(40) commentedAt?: string;
  @IsOptional() @IsString() @MaxLength(120) externalCommentId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ManualCommentDto)
  comments?: ManualCommentDto[];
}

export class LiveOrderItemDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
  @IsInt() @Min(0) unitPriceMinor!: number;
}

export class CreateOrderFromCommentDto {
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LiveOrderItemDto)
  items!: LiveOrderItemDto[];
  @IsOptional() @IsInt() @Min(0) shippingMinor?: number;
  @IsOptional() @IsInt() @Min(0) discountMinor?: number;
}
