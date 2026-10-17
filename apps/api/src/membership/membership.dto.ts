import { IsInt, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** NF7 (FB3) — membership tiers + store credit DTOs. Money is
 * a decimal string of minor units over the wire, like every
 * other commerce DTO. */

export class CreateTierDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  /** Lifetime sold-spend threshold, minor units (string). */
  @IsString() @MaxLength(24) minSpendMinor!: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateTierDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(24) minSpendMinor?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class GrantStoreCreditDto {
  @IsString() @MaxLength(24) amountMinor!: string;
  /** REQUIRED — a grant without a stated reason is refused. */
  @IsString() @MinLength(1) @MaxLength(300) note!: string;
}

export class RefundToCreditDto {
  @IsString() @MaxLength(24) amountMinor!: string;
  /** REQUIRED idempotency key for this refund — a retry with
   * the same key replays the first credit, never a second. */
  @IsString() @MinLength(4) @MaxLength(80) refundKey!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
