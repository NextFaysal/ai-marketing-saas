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

// EC12: start of the WooCommerce wc-auth 1-click flow.
export class StartWcAuthDto {
  @IsString() storeId!: string;
}

export class ConnectShopifyDto {
  @IsString() storeId!: string;
  // Legacy path: shpat_... Admin API access token + app client secret
  // (used for webhook HMAC). Optional since EC2 — either this pair
  // or the clientId/clientSecret pair below must be supplied; the
  // controller/service enforces that one complete pair is present.
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) accessToken?: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) apiSecret?: string;
  // EC2: Dev Dashboard client-credentials pair.
  @IsOptional() @IsString() @MaxLength(500) clientId?: string;
  @IsOptional() @IsString() @MaxLength(500) clientSecret?: string;
}
