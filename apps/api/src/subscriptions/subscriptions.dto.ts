import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/** EC24c: staff-created subscription (v1 has NO storefront
 * self-serve — a subscription is created by staff for a known
 * customer, and renewals are COD/manual orders). */
export class CreateSubscriptionDto {
  @IsString() @MaxLength(100) customerId!: string;
  @IsString() @MaxLength(100) productId!: string;
  @IsOptional() @IsString() @MaxLength(100) variantSku?: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
  @IsOptional() @IsString() @MaxLength(100) createdFromOrderId?: string;
  /** ISO start time; absent = first run one interval from now. */
  @IsOptional() @IsString() @MaxLength(40) startAt?: string;
}
