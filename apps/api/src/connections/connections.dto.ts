import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * CC3 — save a tenant's OWN app (Meta app / TikTok app). Both
 * fields are required: a partial credential can never verify, so
 * accepting one would only store a broken config.
 */
export class PutAppConfigDto {
  @IsString() @MinLength(1) @MaxLength(200) appId!: string;
  @IsString() @MinLength(1) @MaxLength(500) appSecret!: string;
}

/**
 * CC8 — save the tenant's OWN LLM key. Provider must be a real
 * provider (the dev adapter is not a key a tenant can bring);
 * both provider and key are required — the row is written only
 * after a real completion verifies the pair.
 */
export class PutLlmConfigDto {
  @IsString() @IsIn(["openai", "anthropic", "gemini"]) provider!: string;
  @IsString() @MinLength(1) @MaxLength(500) apiKey!: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
}

/**
 * CC9 — save the tenant's OWN payment gateway. All fields are
 * optional at the DTO level because each provider needs a
 * different subset; the service enforces the per-provider
 * required set and refuses before saving anything.
 */
export class PutPaymentGatewayDto {
  // sslcommerz
  @IsOptional() @IsString() @MaxLength(200) storeId?: string;
  @IsOptional() @IsString() @MaxLength(500) storePass?: string;
  // bkash
  @IsOptional() @IsString() @MaxLength(200) username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsOptional() @IsString() @MaxLength(200) appKey?: string;
  @IsOptional() @IsString() @MaxLength(500) appSecret?: string;
  // nagad
  @IsOptional() @IsString() @MaxLength(200) merchantId?: string;
  @IsOptional() @IsString() @MaxLength(10000) privateKey?: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
}

export class SetGatewayEnabledDto {
  @IsBoolean() isEnabled!: boolean;
}

export class InitiateOrderPaymentDto {
  @IsString() @MinLength(1) @MaxLength(100) orderId!: string;
  @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @IsOptional() @IsString() @MaxLength(30) customerPhone?: string;
  @IsOptional() @IsString() @MaxLength(200) customerEmail?: string;
}

/** Public storefront pay-initiation: order id + the order's
 * human number (the tracking-lookup discipline). */
export class PublicInitiatePaymentDto {
  @IsString() @MinLength(1) @MaxLength(100) orderId!: string;
  @IsString() @MinLength(1) @MaxLength(60) orderNumber!: string;
  @IsString() @IsIn(["sslcommerz", "bkash"]) provider!: string;
  /** CC10: "platform" pays through the platform gateway (wallet
   * credit); omitted/"own" is the CC9 tenant-gateway path. */
  @IsOptional() @IsString() @IsIn(["own", "platform"]) source?: string;
}

/** CC10 — toggle the tenant's platform-payment enablement for
 * one provider. */
export class SetPlatformEnabledDto {
  @IsBoolean() isEnabled!: boolean;
}

/** CC10 — request a wallet payout. amountMinor is a decimal
 * string of minor units (validated server-side as an integer);
 * destination carries the tenant's payout details (bKash number
 * or bank account fields), validated per method server-side. */
export class CreatePayoutRequestDto {
  @IsString() @MinLength(1) @MaxLength(30) amountMinor!: string;
  @IsString() @IsIn(["bkash", "bank"]) method!: string;
  @IsObject() destination!: Record<string, unknown>;
}
