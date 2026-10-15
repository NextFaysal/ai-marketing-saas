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
  /** ON11: staff-confirmed district for the customer address
   * (stored as Customer.address.district, the listV2 district
   * filter's canonical field). */
  @IsOptional() @IsString() @MaxLength(60) district?: string;
}

/** ON4: fraud shield settings update (all optional; highValueMinor
 * is integer minor units as a digit string — BigInt-safe). */
export class UpdateFraudSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() autoHoldEnabled?: boolean;
  @IsOptional() @IsIn(["medium", "high"]) autoHoldBand?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: "highValueMinor সঠিক সংখ্যায় পাঠান (পয়সায়)" }) highValueMinor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) burstCount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) burstWindowHours?: number;
}

/** ON4: add a phone to the org blocklist. */
export class CreateBlockedPhoneDto {
  @IsString() @MaxLength(40) phone!: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** ON4: place a staff review hold (reason required, service-validated). */
export class HoldOrderDto {
  @IsString() @MaxLength(300) reason!: string;
}

/** ON4: record a COD phone-call outcome. "rejected" maps onto the
 * stored codConfirmationStatus verdict "declined" in the service. */
export class CodCallDto {
  @IsIn(["confirmed", "rejected", "unreachable", "callback_requested"]) outcome!: string;
}

/** ON11: parse a free-text address into district/thana. */
export class ParseAddressDto {
  @IsOptional() @IsString() @MaxLength(2000) text?: string;
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

/** ON1: replace an order's tags (validation lives in the service
 * so bulk add/remove share it). */
export class SetOrderTagsDto {
  @IsArray() tags!: string[];
}

/** ON1: assign / unassign (null clears) an order. */
export class AssignOrderDto {
  @IsOptional() @IsString() @MaxLength(80) assigneeId!: string | null;
}

/** ON1: a saved list view (filters validated in the service
 * against the list-v2 whitelist). */
export class CreateSavedViewDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(40) queue?: string | null;
  @IsOptional() filters?: Record<string, unknown>;
}

/** ON2: a staff-only internal comment on an order. */
export class CreateOrderCommentDto {
  @IsString() @MaxLength(2000) body!: string;
}

/** ON3 (Order Surgery): one desired line in an item edit.
 * orderItemId = an existing line (quantity / pinned price may
 * change); productId (+ optional variantId) without an
 * orderItemId = a NEW line; bundleId = set the whole EC29
 * bundle group's quantity (the entry addresses the GROUP, never
 * a single component). unitPriceMinor is integer minor units as
 * a digit string — BigInt-safe. */
export class SurgeryItemDto {
  @IsOptional() @IsString() @MaxLength(80) orderItemId?: string;
  @IsOptional() @IsString() @MaxLength(80) productId?: string;
  @IsOptional() @IsString() @MaxLength(80) variantId?: string;
  @IsInt() @Min(0) @Max(9999) quantity!: number;
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: "unitPriceMinor সঠিক সংখ্যায় পাঠান (পয়সায়)" }) unitPriceMinor?: string;
  @IsOptional() @IsString() @MaxLength(80) bundleId?: string;
}

/** ON3: replace an order's item set (PATCH items) or preview
 * the same edit (POST items/preview). couponCode semantics:
 * key absent = keep the order's stored coupon; explicit null =
 * drop the coupon; a string = (re)apply that code. */
export class EditOrderItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SurgeryItemDto)
  items!: SurgeryItemDto[];
  @IsOptional() @IsString() @MaxLength(80) couponCode?: string | null;
  @IsOptional() @IsBoolean() recalculateDelivery?: boolean;
}

/** ON3: one line moved out by a split. */
export class SplitLineDto {
  @IsString() @MaxLength(80) orderItemId!: string;
  @IsInt() @Min(1) @Max(9999) quantity!: number;
}

/** ON3: split an order — the listed lines (partial quantities
 * allowed for ordinary lines; bundle groups move whole) go to a
 * NEW child order. deliveryChargeMinor is the child's shipping
 * in integer minor units as a digit string (default "0"). */
export class SplitOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SplitLineDto)
  lines!: SplitLineDto[];
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: "deliveryChargeMinor সঠিক সংখ্যায় পাঠান (পয়সায়)" }) deliveryChargeMinor?: string;
}

/** ON3: merge 2–5 orders into the survivor named in the route;
 * orderIds INCLUDES the survivor id. */
export class MergeOrdersDto {
  @IsArray() @IsString({ each: true }) orderIds!: string[];
}

/** Feature 2: Cross-Channel Duplicate Order Blocker & Merge Engine.
 * Renamed in Integration-6 union: ON3 surgery already owns the
 * MergeOrdersDto name ({ orderIds }) in this file. */
export class MergeDuplicateOrdersDto {
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

export class AssignOrderPatchDto {
  @IsOptional() @IsString() @MaxLength(80) assigneeId?: string | null;
  @IsOptional() @IsString() agentId?: string;
  @IsOptional() @IsNumber() commissionMinor?: number;
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


