import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** Header that carries the guest cart credential on cart routes. */
export const CART_TOKEN_HEADER = "x-cart-token";

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
}

export class CheckoutDto {
  @IsString() @MinLength(10) @MaxLength(200) cartToken!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsString() @MinLength(5) @MaxLength(500) address!: string;
  @IsString() @MinLength(2) @MaxLength(100) district!: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
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
