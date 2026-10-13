import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateSyncModeDto {
  @IsString() syncMode!: string;
  @IsOptional() @IsObject() fieldOwnership?: Record<string, unknown>;
}

export class ResolveConflictDto {
  @IsIn(["keep_local", "take_remote"]) choice!: string;
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
