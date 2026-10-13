import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
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
}
export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
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
export class AddProductImageDto {
  @IsString() @MinLength(1) @MaxLength(2000) url!: string;
  @IsOptional() @IsString() @MaxLength(500) altText?: string;
}
export class ReorderProductImagesDto {
  @IsArray() @IsString({ each: true }) imageIds!: string[];
}
export class AddBundleItemDto {
  @IsString() componentProductId!: string;
  @IsOptional() @IsString() componentVariantId?: string | null;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
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
}

