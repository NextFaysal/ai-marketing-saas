import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** Header that carries the guest cart credential on cart routes. */
export const CART_TOKEN_HEADER = "x-cart-token";

/** EC25: header that carries the storefront customer session
 * token (issued by the OTP verify endpoint) on account routes
 * and, optionally, on checkout. */
export const SHOP_SESSION_HEADER = "x-shop-session";

// ---------- Public cart / quote / checkout ----------

/** PATCH one cart line. quantity 0 removes the line. */
export class PatchCartLineDto {
  @IsString() @MaxLength(100) productId!: string;
  @IsOptional() @IsString() @MaxLength(100) variantId?: string | null;
  @IsInt() @Min(0) @Max(99) quantity!: number;
  @IsOptional() @IsBoolean() includeBump?: boolean;
}

export class CartContactDto {
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(30) phone?: string;
}

export class QuoteDto {
  @IsString() @MinLength(10) @MaxLength(200) cartToken!: string;
  @IsString() @MinLength(2) @MaxLength(100) district!: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  /** EC16: referral discount preview needs the buyer phone (the
   * quote is otherwise anonymous). Optional; without it the quote
   * shows promotions + coupon only. */
  @IsOptional() @IsString() @MaxLength(40) referralCode?: string;
  @IsOptional() @IsString() @MaxLength(30) buyerPhone?: string;
  /** EC18: the chosen delivery slot + day ("YYYY-MM-DD"). The
   * quote only LISTS applicable slots; checkout validates. */
  @IsOptional() @IsString() @MaxLength(100) deliverySlotId?: string;
  @IsOptional() @IsString() @MaxLength(10) deliveryDate?: string;
  /** EC29: price the gift-wrap fee into the quote when the shop
   * enabled it (the fee itself is read server-side from the
   * shop setting — the client never names an amount). */
  @IsOptional() @IsBoolean() giftWrap?: boolean;
  /** EC30: "pickup" prices the chosen pickup point's own fee
   * instead of a zone delivery charge; anything else = home. */
  @IsOptional() @IsString() @MaxLength(20) deliveryMethod?: string;
  @IsOptional() @IsString() @MaxLength(100) pickupPointId?: string;
}

/** EC18: public order tracking lookup — order number + the
 * phone the order was placed with. Both must match one order. */
export class TrackLookupDto {
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(2) @MaxLength(120) orderNumber!: string;
}

export class CheckoutDto {
  @IsString() @MinLength(10) @MaxLength(200) cartToken!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(5) @MaxLength(500) address!: string;
  @IsString() @MinLength(2) @MaxLength(100) district!: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  /** EC16: another customer's referral code (buyer-side discount,
   * resolved server-side; silent when ineligible). */
  @IsOptional() @IsString() @MaxLength(40) referralCode?: string;
  /** EC32: an affiliate partner's code (partner commission
   * attribution, resolved server-side; silent when ineligible —
   * never a buyer discount). */
  @IsOptional() @IsString() @MaxLength(40) affiliateCode?: string;
  @IsOptional() @IsIn(["cod", "bkash", "nagad"]) paymentMethod?: "cod" | "bkash" | "nagad";
  /** Free-text note from the customer (delivery note etc.). */
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /**
   * Unverified manual-advance claim (e.g. "বিকাশে ২০০ টাকা পাঠিয়েছি,
   * TrxID …"). It is recorded on the order note only — it NEVER
   * marks the order paid; there is no online gateway in EC8.
   */
  @IsOptional() @IsString() @MaxLength(500) advanceNote?: string;
  /** Alias accepted for advanceNote. */
  @IsOptional() @IsString() @MaxLength(500) paymentNote?: string;
  /** EC18: chosen delivery slot + day. Both or neither. */
  @IsOptional() @IsString() @MaxLength(100) deliverySlotId?: string;
  @IsOptional() @IsString() @MaxLength(10) deliveryDate?: string;
  /** EC29: gift wrap (only charged when the shop enabled it and
   * set a fee; the message prints on the packing slip). */
  @IsOptional() @IsBoolean() giftWrap?: boolean;
  @IsOptional() @IsString() @MaxLength(200) giftMessage?: string;
  /** EC30: "pickup" delivers to a pickup point instead of the
   * home address (the address fields stay the customer's own). */
  @IsOptional() @IsString() @MaxLength(20) deliveryMethod?: string;
  @IsOptional() @IsString() @MaxLength(100) pickupPointId?: string;
}

/** EC29: set one bundle line on the cart. quantity 0 removes it. */
export class PatchCartBundleDto {
  @IsString() @MaxLength(100) bundleId!: string;
  @IsInt() @Min(0) @Max(99) quantity!: number;
}

// ---------- EC25: storefront account (OTP auth / orders / wishlist) ----------

export class RequestOtpDto {
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
}

export class VerifyOtpDto {
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(4) @MaxLength(10) code!: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string | null;
}

export class CreateAddressDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string | null;
  @IsString() @MinLength(1) @MaxLength(120) recipientName!: string;
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(5) @MaxLength(500) addressLine!: string;
  @IsString() @MinLength(2) @MaxLength(100) district!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) addressLine?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) district?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class AddWishlistDto {
  @IsString() @MaxLength(100) productId!: string;
}

export class MergeWishlistDto {
  @IsArray() @IsString({ each: true }) productIds!: string[];
}

// ---------- EC28: retention (stock alerts / RMA / Q&A) ----------

/** Back-in-stock subscription — only valid while out of stock. */
export class StockAlertSubscribeDto {
  @IsString() @MaxLength(100) productId!: string;
  @IsOptional() @IsString() @MaxLength(120) variantSku?: string | null;
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
}

export class ReturnLineInputDto {
  @IsString() @MaxLength(100) orderItemId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

/** Customer self-service return/exchange from the tracking page. */
export class CreateCustomerReturnDto {
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(2) @MaxLength(120) orderNumber!: string;
  @IsIn(["return", "exchange"]) type!: "return" | "exchange";
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsOptional() @IsArray() items?: ReturnLineInputDto[];
}

export class AskProductQuestionDto {
  @IsString() @MinLength(2) @MaxLength(120) customerName!: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(30) phone?: string;
  @IsString() @MinLength(5) @MaxLength(1000) question!: string;
}

export class AnswerProductQuestionDto {
  @IsString() @MinLength(1) @MaxLength(2000) answer!: string;
}

export class QuestionVisibilityDto {
  @IsBoolean() hidden!: boolean;
}

// ---------- Staff: settings / zones / domain ----------

export class UpdateStorefrontSettingsDto {
  @IsOptional() @IsBoolean() shopEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(200) shopName?: string | null;
  @IsOptional() @IsString() @MaxLength(500) announcementText?: string | null;
  @IsOptional() @IsBoolean() showFeatured?: boolean;
  @IsOptional() @IsBoolean() showCategories?: boolean;
  @IsOptional() @IsBoolean() showSearch?: boolean;
  @IsOptional() @IsString() @MaxLength(500) metaDescription?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) featuredProductIds?: string[];
  // EC19: featured source + shop language.
  @IsOptional() @IsIn(["merchant_picks", "top_sellers"]) featuredMode?: string;
  @IsOptional() @IsIn(["bn", "en"]) locale?: string;
  // EC18: public tracking page on/off + trust copy.
  @IsOptional() @IsBoolean() trackingPageEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) returnPolicyText?: string | null;
  @IsOptional() @IsString() @MaxLength(500) deliveryPromiseText?: string | null;
  @IsOptional() @IsString() @MaxLength(30) supportPhone?: string | null;
  // EC16: referral-as-discount config. Percent null = feature off.
  @IsOptional() @IsInt() @Min(1) @Max(90) referralDiscountPercent?: number | null;
  @IsOptional() @IsString() referralMinSubtotalMinor?: string | null;
  // EC29: gift wrap config. Fee is integer minor units as a string.
  @IsOptional() @IsBoolean() giftWrapEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(20) giftWrapFeeMinor?: string | null;
  // EC32: affiliate program config. Default percent null = the
  // service's built-in 10% fallback pre-fills new partners.
  @IsOptional() @IsBoolean() affiliateEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(50) affiliateDefaultPercent?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(365) affiliateAttributionDays?: number;
}

const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** EC18: a merchant-defined delivery time window. districtScope
 * null/empty = every district; entries are validated against
 * BD_DISTRICTS in the service. capacityPerDay null = unlimited. */
export class CreateDeliverySlotDto {
  @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsString() @Matches(SLOT_TIME) startTime!: string;
  @IsString() @Matches(SLOT_TIME) endTime!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) districtScope?: string[] | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) capacityPerDay?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateDeliverySlotDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) label?: string;
  @IsOptional() @IsString() @Matches(SLOT_TIME) startTime?: string;
  @IsOptional() @IsString() @Matches(SLOT_TIME) endTime?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) districtScope?: string[] | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) capacityPerDay?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

const ZONE_KINDS = ["inside_dhaka", "outside_dhaka", "district_list", "all"] as const;

/**
 * Zone money fields are integer minor units (poisha) as decimal
 * strings — the same wire convention as DiscountDto.minOrderMinor
 * and ChannelPriceDto.channelPriceMinor. No floats anywhere.
 */
export class CreateZoneDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsIn(ZONE_KINDS) kind!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) districts?: string[] | null;
  @IsString() @MaxLength(20) chargeMinor!: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) deliveryDays?: number | null;
  @IsOptional() @IsString() @MaxLength(20) freeAboveMinor?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) position?: number;
}

export class UpdateZoneDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsIn(ZONE_KINDS) kind?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) districts?: string[] | null;
  @IsOptional() @IsString() @MaxLength(20) chargeMinor?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) deliveryDays?: number | null;
  @IsOptional() @IsString() @MaxLength(20) freeAboveMinor?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) position?: number;
}

// ---------- EC30: shipping rate rules / pickup points ----------

/**
 * Weight-based rate rule. Money is integer minor units as a
 * decimal string (the zone convention); weight bounds are grams,
 * INCLUSIVE, null = unbounded. Semantic validation (min <= max,
 * zone belongs to the org) lives in DeliveryPricingService.
 */
export class CreateShippingRateRuleDto {
  @IsOptional() @IsString() @MaxLength(100) shippingZoneId?: string | null;
  @IsOptional() @IsInt() @Min(0) minWeightGrams?: number | null;
  @IsOptional() @IsInt() @Min(0) maxWeightGrams?: number | null;
  @IsString() @MaxLength(20) chargeMinor!: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateShippingRateRuleDto {
  @IsOptional() @IsString() @MaxLength(100) shippingZoneId?: string | null;
  @IsOptional() @IsInt() @Min(0) minWeightGrams?: number | null;
  @IsOptional() @IsInt() @Min(0) maxWeightGrams?: number | null;
  @IsOptional() @IsString() @MaxLength(20) chargeMinor?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** A merchant outlet / agent point for pickup delivery. The
 * address is PUBLIC outlet info (shown on the tracking page). */
export class CreatePickupPointDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsString() @MinLength(1) @MaxLength(500) address!: string;
  @IsString() @MinLength(1) @MaxLength(100) district!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(20) feeMinor?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdatePickupPointDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(20) feeMinor?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class NdrRecoveryDto {
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(2) @MaxLength(120) orderNumber!: string;
  @IsIn(["reschedule", "alt_phone", "update_address", "instruction"]) action!: "reschedule" | "alt_phone" | "update_address" | "instruction";
  @IsOptional() @IsString() @MaxLength(30) rescheduleDate?: string;
  @IsOptional() @IsString() @MaxLength(30) altPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) updatedAddress?: string;
  @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}

