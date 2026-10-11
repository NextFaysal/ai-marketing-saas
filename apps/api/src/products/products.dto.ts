import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
export class CreateProductDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsEnum(["DRAFT", "ACTIVE", "ARCHIVED"]) status?: string;
  @IsString() price!: string; // decimal string, e.g. "1250.50"
  @IsOptional() @IsString() compareAtPrice?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) bumpTitle?: string;
  @IsOptional() @IsString() bumpPrice?: string;
  @IsOptional() @IsString() @MaxLength(1000) bumpImageUrl?: string;
}
export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsEnum(["DRAFT", "ACTIVE", "ARCHIVED"]) status?: string;
  @IsOptional() @IsString() price?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) bumpTitle?: string;
  @IsOptional() @IsString() bumpPrice?: string;
  @IsOptional() @IsString() @MaxLength(1000) bumpImageUrl?: string;
}
export class CreateVariantDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
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
}

