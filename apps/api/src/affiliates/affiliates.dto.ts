import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * EC32 — affiliate program staff DTOs.
 *
 * A partner's `code` is stored NORMALIZED (trim + uppercase) —
 * the same normalization is applied to a presented code at
 * checkout before lookup, so staff never have to guess the case.
 * `commissionPercent` is validated again in the service (0..50)
 * because the service is also called directly from specs.
 */
export class CreateAffiliatePartnerDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(6) @MaxLength(30) phone!: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string | null;
  /** Optional — when omitted the service generates AFF + 6 chars. */
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsInt() commissionPercent?: number;
  @IsOptional() @IsIn(["active", "paused"]) status?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class UpdateAffiliatePartnerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string | null;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsInt() commissionPercent?: number;
  @IsOptional() @IsIn(["active", "paused"]) status?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

/**
 * EC32: record a payout the merchant made OUTSIDE the system
 * (bKash/Nagad/bank/cash by hand). This is a bookkeeping record
 * only — the system never sends money. amountMinor is a
 * minor-unit integer carried as a string (BigInt-safe), exactly
 * like the EC31 CollectInstallmentDto.
 */
export class RecordAffiliatePayoutDto {
  @IsString() @MaxLength(30) amountMinor!: string;
  @IsIn(["bkash", "nagad", "bank", "cash", "other"]) method!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * OU11: issue a bank-instruction execution for a partner payout
 * (the legal-gated automation rail — see AffiliatesService).
 * `destination` is the payee snapshot the instruction pays to:
 * bkash/nagad need { number }, bank needs
 * { accountNumber, bankName }; cash/other may omit it (the
 * partner's contact snapshot is used). Validated again in the
 * service, like every DTO here.
 */
export class CreateAffiliatePayoutExecutionDto {
  @IsString() @MaxLength(30) amountMinor!: string;
  @IsIn(["bkash", "nagad", "bank", "cash", "other"]) method!: string;
  @IsOptional() @IsObject() destination?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ConfirmAffiliatePayoutExecutionDto {
  @IsString() @MinLength(1) @MaxLength(120) bankReference!: string;
}

export class FailAffiliatePayoutExecutionDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
