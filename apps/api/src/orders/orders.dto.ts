import { Type } from "class-transformer";
import {
  IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches,
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

/** Sales & Data S2: the merchant-facing PATCH vocabulary.
 * "returned" is internal-only: no platform sync produces it as
 * an Order.status (returns live on CourierShipment); it exists
 * so a merchant can mark a COD order returned by hand. */
export const ORDER_PATCH_STATUSES = [
  "pending", "on-hold", "processing", "completed",
  "cancelled", "refunded", "failed", "returned",
] as const;

export class OrderRefundDto {
  /** Refund amount in integer minor units, as a digit string —
   * BigInt-safe end to end (a JSON number would lose precision
   * and invites fractional poisha). */
  @IsString() @Matches(/^\d+$/, { message: "refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)" })
  amountMinor!: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** Sales & Data S2: PATCH /orders/:orderId — every field
 * optional, but at least one must be present (enforced in the
 * service so the Bengali 400 names all three options).
 * internalNote semantics: key absent = untouched, string =
 * set (trimmed; empty-after-trim stores null), null = clear.
 * Nest's pipe keeps an explicit JSON null on the DTO instance,
 * so `dto.internalNote !== undefined` distinguishes clear from
 * untouched. */
export class UpdateOrderDto {
  @IsOptional() @IsIn(ORDER_PATCH_STATUSES) status?: string;
  @IsOptional() @ValidateNested() @Type(() => OrderRefundDto) refund?: OrderRefundDto;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string | null;
  /** EC5: delivery address (the free string on Order.address).
   * Changing it also enqueues a store address push for
   * co-manage/full-manage stores (Woo: shipping.address_1;
   * Shopify: structured fields only — see OrderPushService). */
  @IsOptional() @IsString() @MaxLength(1000) address?: string | null;
}

/** EC5: a customer-visible note pushed to the store order.
 * Deliberately a separate action from internalNote, which is
 * NEVER sent to any platform. */
export class StoreNoteDto {
  @IsString() @MaxLength(1000) note!: string;
}

export class CreateStoreDraftDto {
  @IsOptional() @IsString() @MaxLength(80) storeId?: string;
}

/** EC19: a staff-recorded advance payment against an order
 * (bKash/Nagad/etc. paid directly to the merchant and verified
 * by the staff member recording it). The amount is integer
 * minor units as a decimal string — BigInt-safe end to end.
 * The service re-parses it and enforces amount <= amount due. */
export class AdvanceVerificationDto {
  @IsString() @MaxLength(30) amountMinor!: string;
  @IsIn(["bkash", "nagad", "rocket", "cash", "bank", "other"]) method!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Feature 2: Cross-Channel Duplicate Order Blocker & Merge Engine */
export class MergeOrdersDto {
  @IsString()
  primaryOrderId!: string;

  @IsArray()
  @IsString({ each: true })
  duplicateOrderIds!: string[];

  @IsOptional()
  @IsString()
  mergeReason?: string;
}

/** Feature 5: Team Performance & Staff Sales Attribution */
export class AssignAgentDto {
  @IsString()
  agentId!: string;

  @IsOptional()
  @IsNumber()
  commissionMinor?: number;
}

export class BulkAssignAgentDto {
  @IsArray()
  @IsString({ each: true })
  orderIds!: string[];

  @IsString()
  agentId!: string;
}

export class StaffScoreboardQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsNumber()
  commissionPerDeliveryBdt?: number;
}


