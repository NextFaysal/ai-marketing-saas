import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { PublicCheckoutOrderDto } from "../products/products.dto";

export const LANDING_STATUSES = ["draft", "published", "archived"] as const;

// ---------- Staff: landings ----------

export class CreateLandingDto {
  @IsString() @MaxLength(100) productId!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(200) slug?: string;
  @IsOptional() @IsString() @MaxLength(100) upsellProductId?: string | null;
  @IsOptional() @IsArray() sections?: unknown[];
  @IsOptional() @IsIn(LANDING_STATUSES) status?: string;
}

export class UpdateLandingDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(200) slug?: string;
  @IsOptional() @IsIn(LANDING_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(100) upsellProductId?: string | null;
  @IsOptional() @IsArray() sections?: unknown[];
}

export class CreateLandingVariantDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsBoolean() isControl?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
  @IsOptional() @IsString() @MaxLength(300) headline?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) heroImageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(120) ctaText?: string | null;
  @IsOptional() @IsBoolean() showCompareAt?: boolean;
}

export class UpdateLandingVariantDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() isControl?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
  @IsOptional() @IsString() @MaxLength(300) headline?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) heroImageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(120) ctaText?: string | null;
  @IsOptional() @IsBoolean() showCompareAt?: boolean;
}

// ---------- Public ----------

export class LandingEventDto {
  @IsOptional() @IsString() @MaxLength(200) visitorToken?: string;
  @IsOptional() @IsString() @MaxLength(100) variantId?: string;
}

/**
 * Landing checkout body: exactly the single-product public
 * checkout body (PublicCheckoutOrderDto) plus the district used
 * for ShippingZone matching and the variant that was actually
 * served to this visitor (attribution only — pricing never trusts
 * anything from the client).
 *
 * AB7 (AX19): the order-level attribution block
 * (`attribution?: AttributionDto`) is INHERITED from
 * PublicCheckoutOrderDto — the landing checkout stamps the
 * Order row through the same normalizeAttribution path as the
 * single-product checkout.
 *
 * AB8 (AX27): `deviceHash?: string` is likewise INHERITED from
 * PublicCheckoutOrderDto — the landing checkout normalizes
 * and stamps it through the same path as the single-product
 * checkout.
 */
export class LandingOrderDto extends PublicCheckoutOrderDto {
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(100) servedVariantId?: string;
}
