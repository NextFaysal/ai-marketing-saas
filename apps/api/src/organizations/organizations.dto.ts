import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
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
/** ORG1 (Organization Next OB1): ownership transfer. The target
 * must be an ACTIVE ADMIN member of the same organization —
 * enforced in the service; OWNER is never assignable through the
 * ordinary role endpoint, transfer is this separate path. */
export class TransferOwnershipDto {
  @IsString() @MaxLength(100) targetUserId!: string;
}
/** Milestone 72 (Team W3): per-member custom access overrides.
 * Area keys are validated against the catalog in the service. */
export class UpdateMemberAccessDto {
  @IsOptional() @IsArray() @IsString({ each: true }) grants?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) denies?: string[];
}
/** GB6 (GC16): custom roles. Name/areas/preset semantics are
 * validated in the service (preset expansion, unknown-area
 * naming, per-org uniqueness). */
export class CreateCustomRoleDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) areas?: string[];
  @IsOptional() @IsString() @MaxLength(40) presetKey?: string;
}
export class UpdateCustomRoleDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) areas?: string[];
  // presetKey is immutable — accepted so clients may echo the
  // row back, and ignored by the service.
  @IsOptional() @IsString() @MaxLength(40) presetKey?: string;
}
export class AssignCustomRoleDto {
  @IsOptional() @IsString() @MaxLength(100) customRoleId?: string | null;
}
/** GB6 (GC16): the caller's muted notification categories;
 * keys are validated against the catalog in the service. */
export class UpdateNotificationPreferencesDto {
  @IsArray() @IsString({ each: true }) mutedCategories!: string[];
}
/** Milestone 59: white-label branding. Field-level validation
 * (hex colour, hostname shape, domain uniqueness) lives in the
 * service so error messages stay in the product's voice. */
export class UpdateBrandingDto {
  @IsOptional() @IsString() @MaxLength(120) brandName?: string;
  @IsOptional() @IsString() @MaxLength(20) primaryColor?: string;
  // MX7: brand-kit completion — font is an allowlist key (see
  // messaging/email-blocks.ts BRAND_FONT_STACKS), validated in
  // the service; secondary color is #RRGGBB like primaryColor.
  @IsOptional() @IsString() @MaxLength(40) brandFont?: string;
  @IsOptional() @IsString() @MaxLength(20) brandSecondaryColor?: string;
  @IsOptional() @IsString() @MaxLength(253) customDomain?: string;
  // NF8: the org's own Google review link (URL shape validated
  // in the service, SU5 rss pattern). Empty string / null clears.
  @IsOptional() @IsString() @MaxLength(2048) googleReviewUrl?: string | null;
}
/** ORG5 (Organization Next OB2): the organization's legal name
 * and regional defaults. Shape rules (ISO currency form, IANA
 * timezone, 2-letter country) are enforced in the service so the
 * error messages stay in the product's voice — same split as
 * UpdateBrandingDto. All fields optional (partial update). */
export class UpdateOrgIdentityDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(10) country?: string;
}
/** ML1 (Multi-Language MB1): the organization's dashboard
 * default UI language. Only "bn" / "en" exist — the allowlist
 * is the DTO itself; the service stores exactly what passed. */
export class UpdateOrgLocaleDto {
  @IsIn(["bn", "en"]) dashboardLocale!: string;
}
/** ORG11 (Organization Next OB4): org security policy. OWNER-only
 * at the controller; the service re-checks. sessionMaxAgeHours:
 * an integer 1..720 sets the cap, explicit null clears it, and
 * omitting the field leaves it unchanged. */
export class UpdateSecurityPolicyDto {
  @IsOptional() @IsBoolean() requireMfa?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(720) sessionMaxAgeHours?: number | null;
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
  // SA-B4 (Smart AI P5/P6): AI learning toggles — conversation
  // mining is opt-in (default false, plan D4); website learning
  // fetches only the org's own public websiteUrl.
  @IsOptional() @IsBoolean() conversationLearningEnabled?: boolean;
  @IsOptional() @IsBoolean() websiteLearningEnabled?: boolean;
  // SA-B13 (Smart AI Phase 2, W4): per-org Answer Store switch.
  // OFF = the store neither serves nor captures (rows kept).
  @IsOptional() @IsBoolean() answerStoreEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) minOrderMinor?: number;
  // GB3 (GC8): COD trust rules — money as integer minor units
  // (null clears); blocked districts as a bounded string list.
  @IsOptional() @IsInt() @Min(0) codMaxOrderMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) codAdvanceRequiredAboveMinor?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) codBlockedDistricts?: string[] | null;
  // AB4 (AX5a): deposit / advance-collection config — mode
  // null clears the feature; percent is 1–90; the fixed amount
  // is integer minor units (null clears), stored BigInt via
  // the same MONEY conversion as the cod money fields.
  @IsOptional() @IsIn(["percent", "fixed"]) depositMode?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(90) depositPercent?: number;
  @IsOptional() @IsInt() @Min(0) depositFixedMinor?: number | null;
  @IsOptional() @IsIn(["cod", "online", "all"]) depositAppliesTo?: string;
  @IsOptional() @IsString() @MaxLength(500) depositNote?: string;
  @IsOptional() @IsString() @MaxLength(30) bkashNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) nagadNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) paymentNote?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) advancePaymentPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) returnWindowDays?: number;
  // Milestone 77: owner-set AI behaviour.
  @IsOptional() @IsString() @MaxLength(2000) aiInstructions?: string;
  @IsOptional() @IsString() @MaxLength(10) aiReplyLanguage?: string;
  // GC21 (GB9): merchant verification — trade licence number
  // and the physical business address (distinct from the
  // contact `address` above; submit requires one of them).
  @IsOptional() @IsString() @MaxLength(100) tradeLicenseNo?: string;
  @IsOptional() @IsString() @MaxLength(500) businessAddress?: string;
  // Billing Package B5: invoice/reminder recipients + the
  // buyer block printed on invoices.
  @IsOptional() @IsArray() billingEmails?: string[];
  @IsOptional() @IsString() @MaxLength(300) billingAddress?: string;
  @IsOptional() @IsString() @MaxLength(40) billingBin?: string;
}
/** ORG9 (Organization Next OB3): shareable invite link creation.
 * The role is validated against INVITABLE_ROLES in the service
 * (OWNER can never be handed out through a link). maxUses is
 * optional — omitted means the service default (10); it is never
 * "unlimited". expiresInDays is optional (default 7, M34 style). */
export class CreateInviteLinkDto {
  @IsString() @MaxLength(40) role!: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) expiresInDays?: number;
}
/** ORG10 (Organization Next OB3): a signed-in user asking to join
 * through an invite link. The message is a short optional note to
 * the people who will review the request. */
export class RequestToJoinDto {
  @IsOptional() @IsString() @MaxLength(500) message?: string;
}
/** ORG10: queue decision — approve may override the link's role
 * (validated against INVITABLE_ROLES in the service); reject may
 * carry a short reason shown back to the requester. */
export class ApproveJoinRequestDto {
  @IsOptional() @IsString() @MaxLength(40) role?: string;
}
export class RejectJoinRequestDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
