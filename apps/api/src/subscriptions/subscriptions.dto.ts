import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * OU12: how a customer's auto-charge consent was given, as
 * attested by the staff member recording it. There is no
 * storefront self-serve consent flow (subscriptions are
 * staff-created), so the method is part of the record — a
 * consent without a method is not a recordable consent.
 */
export const AUTO_CHARGE_CONSENT_METHODS = ["phone_call", "in_person", "written", "message"] as const;

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
  /**
   * OU12: record the customer's consent to FUTURE tokenized
   * auto-charge. Consent is stored with a SERVER timestamp —
   * the client never supplies the time. Recording consent does
   * NOT activate charging (no shop tokenized charge path
   * exists in-repo); renewals stay COD/manual.
   */
  @IsOptional() @IsBoolean() autoChargeConsentGiven?: boolean;
  @IsOptional() @IsIn(AUTO_CHARGE_CONSENT_METHODS) autoChargeConsentMethod?: string;
  @IsOptional() @IsString() @MaxLength(500) autoChargeConsentNote?: string;
}

/** OU12: record or withdraw auto-charge consent on an existing
 * subscription. `autoChargeConsentGiven: false` withdraws the
 * consent and clears all three stored fields. */
export class AutoChargeConsentDto {
  @IsBoolean() autoChargeConsentGiven!: boolean;
  @IsOptional() @IsIn(AUTO_CHARGE_CONSENT_METHODS) autoChargeConsentMethod?: string;
  @IsOptional() @IsString() @MaxLength(500) autoChargeConsentNote?: string;
}
