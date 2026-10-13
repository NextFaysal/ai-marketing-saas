import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * EC31 — installment plans on an order's outstanding due.
 * The plan schedules the amount STILL DUE at creation (a
 * snapshot), split across `installmentCount` items spaced
 * `intervalDays` apart starting on `startDate`'s Asia/Dhaka
 * calendar day. `startDate` is an ISO string; only its Dhaka
 * day is used.
 */
export class CreateInstallmentPlanDto {
  @IsInt() @Min(2) @Max(24) installmentCount!: number;
  @IsInt() @Min(1) @Max(90) intervalDays!: number;
  @IsString() @MaxLength(40) startDate!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * EC31: collect money against ONE installment item. Mirrors
 * the EC19 AdvanceVerificationDto shape — the collection is
 * recorded as an approved PaymentVerification in exactly the
 * EC19 shape (plus source "installment" + installmentItemId),
 * so the order's amount due drops by construction.
 * amountMinor is a minor-unit integer carried as a string
 * (BigInt-safe), exactly like the advance DTO.
 */
export class CollectInstallmentDto {
  @IsString() @MaxLength(30) amountMinor!: string;
  @IsIn(["bkash", "nagad", "rocket", "cash", "bank", "other"]) method!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
