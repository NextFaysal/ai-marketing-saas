import { IsArray, IsBoolean, IsEmail, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
export class CreateOrganizationDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  // TD1: mirrors SLUG_FORMAT_REGEX in @repo/contracts — single
  // hyphens between groups only (no leading/trailing/consecutive).
  @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @MinLength(3) @MaxLength(60) slug!: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}
export class InviteMemberDto {
  @IsEmail() email!: string;
  @IsString() role!: string; // validated against invitable roles in the service
}
export class PlanChangeRequestDto {
  @IsString() @MaxLength(20) requestedPlan!: string; // validated against PLAN_TIERS in the service
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AcceptInviteDto {
  @IsString() @MinLength(10) @MaxLength(200) token!: string;
}
/** Milestone 67 (Team T1): member lifecycle. Role/status values
 * are validated against the allowed sets in the service. */
export class UpdateMemberRoleDto {
  @IsString() @MaxLength(40) role!: string;
}
export class UpdateMemberStatusDto {
  @IsString() @MaxLength(20) status!: string; // SUSPENDED | ACTIVE
}
/** Milestone 72 (Team W3): per-member custom access overrides.
 * Area keys are validated against the catalog in the service. */
export class UpdateMemberAccessDto {
  @IsOptional() @IsArray() @IsString({ each: true }) grants?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) denies?: string[];
}
/** Milestone 59: white-label branding. Field-level validation
 * (hex colour, hostname shape, domain uniqueness) lives in the
 * service so error messages stay in the product's voice. */
export class UpdateBrandingDto {
  @IsOptional() @IsString() @MaxLength(120) brandName?: string;
  @IsOptional() @IsString() @MaxLength(20) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(253) customDomain?: string;
}
export class UploadLogoDto {
  @IsString() @MaxLength(3_200_000) dataBase64!: string;
  @IsString() @MaxLength(60) contentType!: string;
}
export class UpdateBusinessProfileDto {
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) industry?: string;
  @IsOptional() @IsString() @MaxLength(100) businessModel?: string;
  @IsOptional() @IsString() @MaxLength(500) websiteUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) goals?: string;
  @IsOptional() @IsString() @MaxLength(1000) brandVoice?: string;
  @IsOptional() @IsString() @MaxLength(2000) uniqueSellingPoints?: string;
  @IsOptional() @IsString() @MaxLength(100) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
  // Milestone 75 (Business Command Center): operational layer.
  // Money arrives as integer minor units and is stored BigInt.
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsObject() businessHours?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) deliveryChargeInsideMinor?: number;
  @IsOptional() @IsInt() @Min(0) deliveryChargeOutsideMinor?: number;
  @IsOptional() @IsInt() @Min(0) freeDeliveryAboveMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) deliveryDaysInside?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) deliveryDaysOutside?: number;
  @IsOptional() @IsBoolean() codAvailable?: boolean;
  @IsOptional() @IsInt() @Min(0) minOrderMinor?: number;
  @IsOptional() @IsString() @MaxLength(30) bkashNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) nagadNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) paymentNote?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) advancePaymentPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) returnWindowDays?: number;
  // Milestone 77: owner-set AI behaviour.
  @IsOptional() @IsString() @MaxLength(2000) aiInstructions?: string;
  @IsOptional() @IsString() @MaxLength(10) aiReplyLanguage?: string;
  // Billing Package B5: invoice/reminder recipients + the
  // buyer block printed on invoices.
  @IsOptional() @IsArray() billingEmails?: string[];
  @IsOptional() @IsString() @MaxLength(300) billingAddress?: string;
  @IsOptional() @IsString() @MaxLength(40) billingBin?: string;
}
