import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { OnlinePaymentSelectionDto } from "../connections/connections.dto";
import { AttributionDto } from "../common/attribution.dto";

/** EC24 product-model fields shared by create/update DTOs.
 * Element-level wholesale tier validation + the digital /
 * subscription conditionals live in the service (commerce/ec24),
 * mirroring the EC23 taxRateBps validation placement. */
export class Ec24ProductFields {
  @IsOptional() @IsBoolean() preorderEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(40) preorderReleaseDate?: string | null;
  @IsOptional() @IsInt() @Min(1) preorderLimit?: number | null;
  @IsOptional() @IsBoolean() digital?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) digitalFileUrl?: string | null;
  @IsOptional() @IsInt() @Min(1) digitalAccessLimit?: number | null;
  // AB5 (AX9): delivery type + signed-link lifetime. The
  // semantic ranges (type ∈ file|license|both, hours 1..720 or
  // null) are validated in the service (normalizeEc24Fields)
  // with Bengali errors, mirroring digitalAccessLimit above.
  @IsOptional() @IsString() @MaxLength(20) digitalDeliveryType?: string;
  @IsOptional() @IsInt() digitalLinkExpiryHours?: number | null;
  @IsOptional() @IsBoolean() subscriptionEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) subscriptionIntervalDays?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) subscriptionDiscountPercent?: number | null;
  @IsOptional() @IsArray() wholesaleTiers?: Array<{ minQty: number; priceMinor: string | number }> | null;
  // GB1 (GC4): product video (YouTube/Vimeo/mp4/webm URL +
  // optional poster). Shape is service-validated via the shared
  // normalizer in products/product-video.ts.
  @IsOptional() @IsString() @MaxLength(1000) videoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) videoPosterUrl?: string | null;
  // AB2 (AX3): gift-card product flag + face-value config
  // ({ presetAmountsMinor, allowCustomAmount, minAmountMinor?,
  // maxAmountMinor? }). The config's semantic validation lives
  // in the service via commerce/gift-cards.validateGiftCardConfig
  // (Bengali 400s), mirroring the wholesale-tier placement above.
  @IsOptional() @IsBoolean() isGiftCard?: boolean;
  @IsOptional() @IsObject() giftCardConfig?: Record<string, unknown> | null;
}
export class CreateProductDto extends Ec24ProductFields {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  // AB6 (AX13): English alternate name/description for en-locale shops.
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) descriptionEn?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsEnum(["DRAFT", "ACTIVE", "ARCHIVED"]) status?: string;
  @IsString() price!: string; // decimal string, e.g. "1250.50"
  @IsOptional() @IsString() compareAtPrice?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @IsOptional() @IsInt() @Min(0) lowStockThreshold?: number;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) bumpTitle?: string;
  @IsOptional() @IsString() bumpPrice?: string;
  @IsOptional() @IsString() @MaxLength(1000) bumpImageUrl?: string;
  // EC3 catalog enrichment (physical / barcode / SEO / taxonomy)
  @IsOptional() @IsInt() @Min(0) weightGrams?: number;
  @IsOptional() @IsInt() @Min(0) lengthCm?: number;
  @IsOptional() @IsInt() @Min(0) widthCm?: number;
  @IsOptional() @IsInt() @Min(0) heightCm?: number;
  @IsOptional() @IsString() @MaxLength(100) barcode?: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tagIds?: string[];
  // EC23: per-product VAT rate override in basis points
  // (1500 = 15.00%, 750 = 7.5%). Null = org TaxSetting default.
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBps?: number | null;
  // GB2 (GC6): brand link (in-org existence service-checked,
  // mirroring categoryId) + per-product free-shipping flag.
  @IsOptional() @IsString() brandId?: string | null;
  @IsOptional() @IsBoolean() freeShipping?: boolean;
}
export class UpdateProductDto extends Ec24ProductFields {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  // AB6 (AX13): English alternate name/description (null/"" clears).
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) descriptionEn?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsEnum(["DRAFT", "ACTIVE", "ARCHIVED"]) status?: string;
  @IsOptional() @IsString() price?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @IsOptional() @IsInt() @Min(0) lowStockThreshold?: number;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) bumpTitle?: string;
  @IsOptional() @IsString() bumpPrice?: string;
  @IsOptional() @IsString() @MaxLength(1000) bumpImageUrl?: string;
  // EC3 catalog enrichment (physical / barcode / SEO / taxonomy)
  @IsOptional() @IsInt() @Min(0) weightGrams?: number;
  @IsOptional() @IsInt() @Min(0) lengthCm?: number;
  @IsOptional() @IsInt() @Min(0) widthCm?: number;
  @IsOptional() @IsInt() @Min(0) heightCm?: number;
  @IsOptional() @IsString() @MaxLength(100) barcode?: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tagIds?: string[];
  // EC23: per-product VAT rate override (basis points, see create).
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBps?: number | null;
  // GB2 (GC6): brand link (null clears) + free-shipping flag.
  @IsOptional() @IsString() brandId?: string | null;
  @IsOptional() @IsBoolean() freeShipping?: boolean;
}
export class CreateVariantDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsString() price?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
}
export class UpdateVariantDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsString() price?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
}
export class SetCostDto {
  @IsString() cost!: string; // decimal string
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// ---------- EC3: taxonomy / images / bundles / bulk edit ----------

export class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}
export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}
export class CreateTagDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
}

// ---------- GB2 (GC6): brands + bulk delete ----------

export class CreateBrandDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
}

export class UpdateBrandDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
}

/** GB2 (GC6): bulk delete — per-product outcomes (deleted /
 * archived / not_found) are computed in the service; the cap
 * mirrors the bulk-edit ceiling. */
export class BulkDeleteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) ids!: string[];
}
export class AddProductImageDto {
  @IsString() @MinLength(1) @MaxLength(2000) url!: string;
  @IsOptional() @IsString() @MaxLength(500) altText?: string;
}
export class ReorderProductImagesDto {
  @IsArray() @IsString({ each: true }) imageIds!: string[];
}
/** RM4: step 1 of the direct-to-R2 upload — declare the file;
 * the service validates type/size and returns a presigned PUT. */
export class PresignProductImageDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}
/** RM4: step 2 — the browser has PUT the bytes to the quarantine
 * key; the service verifies HEAD size + magic bytes before the
 * object becomes a gallery image. */
export class CompleteProductImageDto {
  @IsString() @MaxLength(500) key!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}
/** RB6b (plan D3): the auto-mirror opt-out toggle. True = the
 * scheduled sweep mirrors external product/review images for
 * this org (the default); false = the org opted out. */
export class SetProductImageAutoMirrorDto {
  @IsBoolean() productImageAutoMirror!: boolean;
}
/** RB6/RM9: step 1 of the digital-file upload — the merchant
 * names the file; the service refuses executable extensions and
 * hands back a presigned PUT URL for a PRIVATE quarantine key. */
export class PresignDigitalFileDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}
/** RB6/RM9: step 2 — the bytes are in quarantine; the service
 * HEAD-verifies the size (and hashes small files) before the
 * object becomes the product's hosted digital file. */
export class CompleteDigitalFileDto {
  @IsString() @MaxLength(500) key!: string;
  @IsString() @MaxLength(255) fileName!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}
export class AddBundleItemDto {
  @IsString() componentProductId!: string;
  @IsOptional() @IsString() componentVariantId?: string | null;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}
/** CP5: batch store push — the service enforces the same
 *  non-empty / max-50 rules with Bengali errors. */
export class PushBatchDto {
  @IsArray() @IsString({ each: true }) productIds!: string[];
}

export class BulkEditDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) productIds!: string[];
  @IsIn(["price_percent", "price_fixed", "stock_set", "category_set"]) action!: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(500) percent?: number;
  @IsOptional() @IsString() price?: string;
  @IsOptional() @IsInt() @Min(0) quantity?: number;
  @IsOptional() @IsString() categoryId?: string;
}

export class PublicCheckoutOrderDto {
  @IsString() @MinLength(2) @MaxLength(120) customerName!: string;
  @IsString() @MinLength(10) @MaxLength(20) customerPhone!: string;
  @IsString() @MinLength(5) @MaxLength(500) customerAddress!: string;
  @IsOptional() @IsString() deliveryZone?: "inside_dhaka" | "outside_dhaka";
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() paymentMethod?: "cod" | "bkash" | "nagad";
  @IsOptional() includeBump?: boolean;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  /** EC16: another customer's referral code. Buyer-side discount
   * only, resolved server-side; an unresolvable/self/repeat code
   * silently grants nothing (never an error). */
  @IsOptional() @IsString() @MaxLength(40) referralCode?: string;
  /** EC32: an affiliate partner's code (partner commission
   * attribution, resolved server-side; silent when ineligible —
   * never a buyer discount). Covers the landing checkout too:
   * LandingOrderDto extends this DTO. */
  @IsOptional() @IsString() @MaxLength(40) affiliateCode?: string;
  /** EC18: chosen delivery slot + day ("YYYY-MM-DD"). Both or
   * neither; the district is unknown on this path, so only
   * all-district slots can be chosen here. */
  @IsOptional() @IsString() @MaxLength(100) deliverySlotId?: string;
  @IsOptional() @IsString() @MaxLength(10) deliveryDate?: string;
  /** EC29: gift wrap (only charged when the shop enabled it and
   * set a fee) + the packing-slip gift message. */
  @IsOptional() @IsBoolean() giftWrap?: boolean;
  @IsOptional() @IsString() @MaxLength(200) giftMessage?: string;
  /** GC10: online-payment selection (own/platform gateway).
   * Marker-only on this surface — see ProductsService.
   * (inherited by LandingOrderDto). */
  @IsOptional() @ValidateNested() @Type(() => OnlinePaymentSelectionDto)
  onlinePayment?: OnlinePaymentSelectionDto;
  /** GB3 (GC8): terms consent + idempotency + CAPTCHA token
   * (inherited by LandingOrderDto). */
  @IsOptional() @IsBoolean() termsAccepted?: boolean;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
  @IsOptional() @IsString() @MaxLength(2048) captchaToken?: string;
  /** AB1 (AX1): loyalty points to redeem (inherited by
   * LandingOrderDto). Priced server-side from the phone-resolved
   * customer's balance; an over-request is clamped, never an
   * error. */
  @IsOptional() @IsInt() @Min(0) @Max(1000000) loyaltyPoints?: number;
  /** AB2 (AX3): a gift-card code to redeem against this order
   * (inherited by LandingOrderDto). Resolved server-side by
   * GiftCardsService.resolveForCheckout; any refusal (invalid /
   * disabled / void / expired / depleted, or this product IS a
   * gift card) fails the checkout BEFORE placement. */
  @IsOptional() @IsString() @MaxLength(32) giftCardCode?: string;
  /** AB4 (AX5b): answers to the org's custom checkout fields —
   * validated server-side against the ACTIVE defs for the
   * placing surface ("single" here; "landing" for the landing
   * subclass) before any order write; the validated map lands
   * on Order.checkoutFields. */
  @IsOptional() @IsObject() fieldAnswers?: Record<string, string | boolean>;
  /** AB7 (AX19): order-level attribution stamps (UTM + click
   * id) captured by the client — normalized at placement and
   * stamped onto the Order row (inherited by LandingOrderDto,
   * so the landing checkout carries it too). Absent = the
   * order stays untracked (all stamp columns null). */
  @IsOptional() @ValidateNested() @Type(() => AttributionDto)
  attribution?: AttributionDto;
  /** AB8 (AX27): device fingerprint hash (64-char hex) —
   * normalized server-side; invalid/absent = no stamp.
   * Inherited by LandingOrderDto, so the landing checkout
   * carries it too. */
  @IsOptional() @IsString() @MaxLength(64) deviceHash?: string;
}

