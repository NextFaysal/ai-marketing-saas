import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";
export class CreateStoreDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() platform?: string; // WOOCOMMERCE | SHOPIFY | CUSTOM
  @IsUrl({ require_tld: false }) @MaxLength(500) url!: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() timezone?: string;
}
export class ConnectWooDto {
  @IsString() storeId!: string;
  @IsString() @MinLength(5) consumerKey!: string;
  @IsString() @MinLength(5) consumerSecret!: string;
  @IsOptional() @IsString() @MaxLength(500) webhookSecret?: string;
}

export class ConnectShopifyDto {
  @IsString() storeId!: string;
  @IsString() @MinLength(10) accessToken!: string; // shpat_... Admin API access token
  @IsString() @MinLength(5) apiSecret!: string; // app client secret, used for webhook HMAC
}
