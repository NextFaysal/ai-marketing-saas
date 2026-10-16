import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OnlinePaymentSelectionDto } from "../connections/connections.dto";
import { AttributionDto } from "../common/attribution.dto";

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
  // AB2 (AX3): gift-card face value for a gift-card product line
  // (decimal integer string, minor units — the line's unit price
  // becomes this amount, validated against the product config at
  // quote time) + the recipient the issued card is addressed to.
  @IsOptional() @IsString() @MaxLength(20) giftCardAmountMinor?: string;
  @IsOptional() @IsString() @MaxLength(120) giftCardRecipientName?: string;
  @IsOptional() @IsString() @MaxLength(200) giftCardRecipientEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) giftCardRecipientPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) giftCardRecipientMessage?: string;
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
  /** AB1 (AX1): loyalty points the shopper wants to redeem. The
   * server prices only what the identified customer's balance +
   * the program caps allow — an over-request is clamped by the
   * evaluator, never an error. */
  @IsOptional() @IsInt() @Min(0) @Max(1000000) loyaltyPoints?: number;
  /** AB2 (AX3): a gift-card code to redeem against this cart.
   * Resolved server-side; any refusal fails the quote/checkout
   * BEFORE placement (a gift card can never buy a gift card). */
  @IsOptional() @IsString() @MaxLength(32) giftCardCode?: string;
}

/** AB2 (AX3): public gift-card balance lookup body. The code is
 * a bearer credential — the endpoint is rate-limited and the
 * service answers a generic error for unknown/wrong-org codes. */
export class GiftCardBalanceDto {
  @IsString() @MinLength(4) @MaxLength(40) code!: string;
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
  /** GC10: pay online through a real gateway (own/platform)
   * instead of COD/manual. Re-validated server-side against
   * TenantPaymentsService.publicPaymentOptions. */
  @IsOptional() @ValidateNested() @Type(() => OnlinePaymentSelectionDto)
  onlinePayment?: OnlinePaymentSelectionDto;
  /** GB3 (GC8): terms consent + idempotency + CAPTCHA token. */
  @IsOptional() @IsBoolean() termsAccepted?: boolean;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
  @IsOptional() @IsString() @MaxLength(2048) captchaToken?: string;
  /** AB1 (AX1): loyalty points to redeem (see QuoteDto). */
  @IsOptional() @IsInt() @Min(0) @Max(1000000) loyaltyPoints?: number;
  /** AB2 (AX3): a gift-card code to redeem (see QuoteDto). */
  @IsOptional() @IsString() @MaxLength(32) giftCardCode?: string;
  /** AB4 (AX5b): answers to the org's custom checkout fields
   * for the "shop" surface — validated server-side against the
   * ACTIVE defs (unknown keys / missing required → 400 before
   * any order write); the validated map lands on the order. */
  @IsOptional() @IsObject() fieldAnswers?: Record<string, string | boolean>;
  /** AB7 (AX19): order-level attribution stamps captured by
   * the shop client (UTM + click id). Normalized at placement
   * and stamped onto the Order row; absent = untracked. */
  @IsOptional() @ValidateNested() @Type(() => AttributionDto)
  attribution?: AttributionDto;
  /** AB8 (AX27): device fingerprint hash (64-char hex) —
   * normalized server-side; invalid/absent = no stamp. */
  @IsOptional() @IsString() @MaxLength(64) deviceHash?: string;
}

/**
 * AB4 (AX5c): express checkout — a signed-in shop customer
 * places the cart against a SAVED address in one call. The
 * session token rides the x-shop-session header (like the
 * account routes); everything else mirrors CheckoutDto's
 * optional payment/consent fields.
 */
export class ExpressCheckoutDto {
  @IsString() @MinLength(10) @MaxLength(200) cartToken!: string;
  @IsOptional() @IsString() @MaxLength(100) addressId?: string;
  @IsOptional() @IsIn(["cod", "bkash", "nagad"]) paymentMethod?: "cod" | "bkash" | "nagad";
  @IsOptional() @ValidateNested() @Type(() => OnlinePaymentSelectionDto)
  onlinePayment?: OnlinePaymentSelectionDto;
  @IsOptional() @IsObject() fieldAnswers?: Record<string, string | boolean>;
  @IsOptional() @IsBoolean() termsAccepted?: boolean;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
  /** AB7 (AX19): attribution stamps (see CheckoutDto) — the
   * express path forwards them into checkout(). */
  @IsOptional() @ValidateNested() @Type(() => AttributionDto)
  attribution?: AttributionDto;
  /** AB8 (AX27): device fingerprint hash — the express path
   * forwards it into checkout() like attribution. */
  @IsOptional() @IsString() @MaxLength(64) deviceHash?: string;
}

/** EC29: set one bundle line on the cart. quantity 0 removes it. */
export class PatchCartBundleDto {
  @IsString() @MaxLength(100) bundleId!: string;
  @IsInt() @Min(0) @Max(99) quantity!: number;
  /** AB5 (AX8): the buyer's slot picks ([{ slotId, productId }])
   *  for a mix-and-match bundle — validated server-side by
   *  BundlesService.validatePicks at cart write and re-validated
   *  at quote/placement. Required when the bundle has slots. */
  @IsOptional() @IsArray() picks?: any[];
}

// ---------- EC25: storefront account (OTP auth / orders / wishlist) ----------

export class RequestOtpDto {
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  /** GB3 (GC9): CAPTCHA token for the OTP gate surface. */
  @IsOptional() @IsString() @MaxLength(2048) captchaToken?: string;
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
  // GB1 (GC1/GC4): theme + favicon + direct contact channels.
  // URL/phone shape is service-validated (Bengali errors).
  @IsOptional()
  @IsIn([
    "classic",
    "bold",
    "minimal",
    "luxury",
    "organic",
    "vibrant",
    "modern",
    "pastel",
    "nordic",
    "midnight",
    "fashion",
    "electronics",
    "grocery",
    "beauty",
    "furniture",
    "books",
    "kids",
    "automotive",
    "sports",
    "jewelry",
  ])
  themeId?: string;
  @IsOptional() @IsString() @MaxLength(1000) faviconUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(30) whatsappNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) messengerUrl?: string | null;
  // GB3 (GC8): checkout terms consent requirement + external terms URL.
  @IsOptional() @IsBoolean() requireTermsConsent?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) termsUrl?: string | null;
  // AB8 (AX23): merchant custom CSS/JS for the shop. Length
  // (≤50,000) and breakout (</style / <!-- / </script) checks
  // are service-enforced with Bengali errors; null clears.
  @IsOptional() @IsString() @MaxLength(50000) customCss?: string | null;
  @IsOptional() @IsString() @MaxLength(50000) customJs?: string | null;
  @IsOptional() @IsBoolean() customJsEnabled?: boolean;
}

// ---------- GB1: content pages / popup / contact ----------

/** GB1 (GC2): create a shop content page. `blocks` is deep-
 * validated in storefront/shop-pages.ts (fixed block types). */
export class CreateShopPageDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsArray() blocks?: unknown[];
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsBoolean() showInFooter?: boolean;
  @IsOptional() @IsBoolean() showInMenu?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class UpdateShopPageDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsArray() blocks?: unknown[];
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsBoolean() showInFooter?: boolean;
  @IsOptional() @IsBoolean() showInMenu?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

// ---------- AB6 (AX12): blog posts (staff + public) ----------

/** Create a shop blog post. `blocks` is deep-validated in
 * storefront/shop-pages.ts (the same fixed block types as
 * shop pages); `tags` is normalized in the service. */
export class CreateBlogPostDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(500) excerpt?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) coverImageUrl?: string | null;
  @IsOptional() @IsArray() blocks?: unknown[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(["draft", "published"]) status?: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(100) authorName?: string | null;
}

export class UpdateBlogPostDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(500) excerpt?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) coverImageUrl?: string | null;
  @IsOptional() @IsArray() blocks?: unknown[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(["draft", "published"]) status?: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(100) authorName?: string | null;
}

// ---------- AB6 (AX11): search synonyms (staff) ----------

/** A merchant search synonym: `term` plus its expansion phrases.
 * Shape limits (≤100 chars, ≤10 expansions) are service-enforced
 * with Bengali errors after normalization. */
export class CreateSearchSynonymDto {
  @IsString() @MaxLength(200) term!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) expansions?: string[];
}

export class UpdateSearchSynonymDto {
  @IsOptional() @IsString() @MaxLength(200) term?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) expansions?: string[];
}

/** GB1 (GC3): the shop's single popup config (upsert). URL and
 * schedule cross-checks are service-validated. */
export class UpsertStorePopupDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(200) title?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) body?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(100) ctaText?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) ctaUrl?: string | null;
  @IsOptional() @IsIn(["delay_seconds", "scroll_percent", "exit_intent"]) trigger?: string;
  @IsOptional() @IsInt() @Min(0) @Max(120) delaySeconds?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) scrollPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) frequencyDays?: number;
  @IsOptional() @IsString() @MaxLength(40) startsAt?: string | null;
  @IsOptional() @IsString() @MaxLength(40) endsAt?: string | null;
  @IsOptional() @IsIn(["home", "all"]) showOn?: string;
}

export class PopupEventDto {
  @IsIn(["impression", "click"]) kind!: string;
}

/** GB1 (GC2): public shop contact form. */
export class ContactMessageDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(5) @MaxLength(30) phone!: string;
  @IsString() @MinLength(1) @MaxLength(2000) message!: string;
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

