import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateSyncModeDto {
  // CP3: syncMode is now optional so the same store-settings
  // surface can carry a weightUnit-only update.
  @IsOptional() @IsString() syncMode?: string;
  @IsOptional() @IsObject() fieldOwnership?: Record<string, unknown>;
  /** CP3: manual override of the store's weight unit (null clears
   *  back to the legacy kg default). */
  @IsOptional() @IsIn(["g", "kg", "lb", "oz"]) weightUnit?: string | null;
}

export class ResolveConflictDto {
  @IsIn(["keep_local", "take_remote", "per_field"]) choice!: string;
  /** CP1: per_field only — { fieldName: "local" | "remote" } for
   *  EXACTLY the fields in the conflict's fieldDiffs. */
  @IsOptional() @IsObject() choices?: Record<string, string>;
}

export class ChannelPriceDto {
  // Integer minor units as a decimal string, or null to clear the override.
  @IsOptional() @IsString() channelPriceMinor?: string | null;
}

export class SaleScheduleDto {
  @IsOptional() @IsString() saleStartsAt?: string | null;
  @IsOptional() @IsString() saleEndsAt?: string | null;
}

export class CreateLocationDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) externalLocationId?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateLocationDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** EC5: OWNER-only refund-push toggle (dedicated route + @Roles("OWNER")). */
export class UpdateRefundPushDto {
  @IsBoolean() enabled!: boolean;
}

/** EC7: create/update a StoreDiscount. minOrderMinor is minor units
 *  as a decimal string (BigInt over the wire), same as channel price. */
export class DiscountDto {
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsIn(["percent", "fixed", "free_shipping"]) kind?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) value?: number;
  @IsOptional() @IsString() minOrderMinor?: string | null;
  @IsOptional() @IsIn(["all", "products", "categories"]) scopeType?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) scopeIds?: string[] | null;
  @IsOptional() @IsString() startsAt?: string | null;
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) storeIds?: string[];
}

export class SetDiscountActiveDto {
  @IsBoolean() active!: boolean;
}

/** EC16: create/update a Promotion. `config` is the per-type
 * document validated server-side by validatePromotionConfig
 * (bogo | tiered | flash); dates are ISO strings or null. */
export class PromotionDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(["bogo", "tiered", "flash", "gift"]) type?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsString() startsAt?: string | null;
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(-100) @Max(100) priority?: number;
}

export class SetPromotionActiveDto {
  @IsBoolean() active!: boolean;
}

/** EC29: create/update a Bundle. `items` is the untyped
 * component array ([{ productId, variantSku?, qty }]) validated
 * server-side by BundlesService.validateItems; bundlePriceMinor
 * is integer minor units as a decimal string. */
export class BundleDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string | null;
  @IsOptional() @IsArray() items?: any[];
  @IsOptional() @IsString() bundlePriceMinor?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

/** EC16: cart-simulator preview — product ids + quantities are
 * priced from the REAL product rows server-side; no client math. */
export class PromotionPreviewDto {
  @IsArray() items!: Array<{ productId: string; quantity?: number }>;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  @IsOptional() @IsString() @MaxLength(40) referralCode?: string;
  @IsOptional() @IsString() @MaxLength(32) buyerPhone?: string;
}

export class GenerateCampaignDto {
  @IsString() @MaxLength(16) prefix!: string;
  @IsInt() @Min(1) @Max(500) count!: number;
  @IsIn(["percent", "fixed", "free_shipping"]) kind!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) value?: number;
  @IsOptional() @IsString() minOrderMinor?: string | null;
  @IsOptional() @IsString() startsAt?: string | null;
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
}

/** EC5: the store's shipment-plugin tracking meta key (nullable to clear). */
export class UpdateTrackingMetaKeyDto {
  @IsOptional() @IsString() @MaxLength(120) courierTrackingMetaKey?: string | null;
}
