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

/** NF7 (FB3): the per-store refund-to-credit opt-in toggle —
 * the same shape as UpdateRefundPushDto, its neighbour in the
 * per-store refund settings area. Default OFF. */
export class UpdateRefundToCreditDto {
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
  // GB7 (GC17)
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsBoolean() repeatCustomerOnly?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(1000) perCustomerLimit?: number | null;
  @IsOptional() @IsString() maxOrderMinor?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) excludedProductIds?: string[] | null;
  @IsOptional() @IsArray() @IsString({ each: true }) excludedCategoryIds?: string[] | null;
  // NF14 (FB5): app-only offer — display rule only (the code
  // still redeems normally everywhere; see DiscountsService).
  @IsOptional() @IsBoolean() appOnly?: boolean;
}

/** GB7: per-org abandoned-cart recovery coupon template. */
export class AbandonedCouponSettingDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(["percent", "fixed"]) kind?: "percent" | "fixed";
  @IsOptional() @IsInt() @Min(0) @Max(100000000) value?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) expiryHours?: number;
  @IsOptional() @IsString() minOrderMinor?: string | null;
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
  /** AB5 (AX8): mix-and-match slots ([{ label, chooseQty,
   *  sourceType, sourceRef }]) validated server-side by
   *  BundlesService.validateSlots; when present (incl. []) the
   *  bundle's slots are replaced wholesale, when absent they
   *  are untouched. */
  @IsOptional() @IsArray() slots?: any[];
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

/** AB1 (AX1): loyalty program settings. All fields optional —
 * the service applies only the provided ones (null clears the
 * nullable caps). Range validation lives in LoyaltyService so
 * the Bengali errors match the rest of the commerce surface. */
export class LoyaltySettingDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() earnPointsPer1000Minor?: number;
  @IsOptional() @IsInt() redeemValueMinorPerPoint?: number;
  @IsOptional() @IsInt() minRedeemPoints?: number;
  @IsOptional() @IsInt() maxRedeemSharePct?: number | null;
  @IsOptional() @IsInt() pointsExpiryDays?: number | null;
}

/** AB1 (AX2): referral reward settings — what the REFERRER
 * earns when a referred order becomes sold. */
export class ReferralRewardSettingDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(["points", "coupon"]) rewardType?: "points" | "coupon";
  @IsOptional() @IsInt() rewardPoints?: number | null;
  @IsOptional() @IsInt() couponPercent?: number | null;
  @IsOptional() @IsString() rewardMinOrderMinor?: string | null;
}

/** AB1 (AX1): a staff manual points correction. The note is
 * mandatory (enforced in the service) — every adjust explains
 * itself in the customer's ledger. */
export class LoyaltyAdjustDto {
  @IsInt() deltaPoints!: number;
  @IsString() @MaxLength(500) note!: string;
}

/** AB2 (AX3): gift-card settings. All fields optional — the
 * service applies only the provided ones (null clears the
 * default expiry). Range validation lives in GiftCardsService
 * so the Bengali errors match the rest of the commerce surface. */
export class GiftCardSettingDto {
  @IsOptional() @IsBoolean() redemptionEnabled?: boolean;
  @IsOptional() @IsInt() defaultExpiryDays?: number | null;
}

/** AB2 (AX3): a staff manual gift-card issue. amountMinor is
 * integer minor units as a decimal string (BigInt over the
 * wire). A recipient contact (valid email or a phone) and the
 * note are mandatory — enforced in the service, because the
 * code is sent ONLY to the recipient and shown nowhere else. */
export class ManualGiftCardIssueDto {
  @IsString() amountMinor!: string;
  @IsOptional() @IsString() @MaxLength(200) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(200) recipientEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) recipientPhone?: string;
  @IsString() @MaxLength(500) note!: string;
}

/** AB2 (AX3): a staff gift-card action that must explain
 * itself (void). The note is mandatory in the service. */
export class GiftCardNoteDto {
  @IsString() @MaxLength(500) note!: string;
}

/** AB2 (AX3): a staff balance correction. deltaMinor is a
 * signed integer-minor decimal string; the note is mandatory
 * in the service — every adjust explains itself in the ledger. */
export class GiftCardAdjustDto {
  @IsString() deltaMinor!: string;
  @IsString() @MaxLength(500) note!: string;
}

/** AB5 (AX7): a B2B customer group (name unique per org —
 * enforced in PriceListsService with a Bengali 400). */
export class CustomerGroupDto {
  @IsString() @MaxLength(200) name!: string;
}

export class UpdateCustomerGroupDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
}

/** AB5 (AX7): one explicit price-list row. priceMinor is
 * integer minor units as a decimal string; variantId null /
 * absent = the product-level price. */
export class PriceListItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string | null;
  @IsString() priceMinor!: string;
}

/** AB5 (AX7): materialize a %-off as explicit product-level
 * rows (percentOff 1..99 validated in the service). */
export class BulkPercentOffDto {
  @IsInt() percentOff!: number;
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
}

/** AB5 (AX7): a staff-issued quote. Lines are validated +
 * snapshotted (name/sku) in QuotesService; totals are
 * Σ lines + deliveryChargeMinor with NO tax/promotion
 * evaluation. customerId OR walk-in details identify the buyer. */
export class QuoteDto {
  @IsOptional() @IsString() customerId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) walkinName?: string | null;
  @IsOptional() @IsString() @MaxLength(40) walkinPhone?: string | null;
  @IsOptional() @IsArray() lines?: any[];
  @IsOptional() @IsString() deliveryChargeMinor?: string;
  @IsOptional() @IsString() expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class UpdateQuoteDto {
  @IsOptional() @IsString() customerId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) walkinName?: string | null;
  @IsOptional() @IsString() @MaxLength(40) walkinPhone?: string | null;
  @IsOptional() @IsArray() lines?: any[];
  @IsOptional() @IsString() deliveryChargeMinor?: string;
  @IsOptional() @IsString() expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

/** AB5 (AX7): the public quote-page response (accept/decline). */
export class QuoteRespondDto {
  @IsBoolean() accept!: boolean;
}

/** AB5 (AX9): a staff license-key pool import. `text` is the raw
 * newline-separated key list (one vendor key per line; the exact
 * trimmed string is canonical and case-sensitive). Line-level
 * dedupe / invalid rules + the 500-line ceiling live in
 * LicenseKeysService with Bengali errors. */
export class LicenseKeyImportDto {
  @IsString() productId!: string;
  @IsString() @MaxLength(200000) text!: string;
  @IsOptional() @IsString() @MaxLength(100) batch?: string;
}
