import { IsBoolean, IsIn, IsString, MaxLength, MinLength } from "class-validator";

/**
 * SA-B23 (Smart AI Phase 6, T1 console family): the per-org
 * Brain VIEW/FIX surface for SUPER admins.
 *
 * Every FIX body carries a non-empty `reason`. The reason is
 * not decoration: an admin reaching into a tenant's Brain is
 * the most sensitive act in the program, so each fix stores
 * its reason in the admin audit row (and, for a learned-item
 * review, on the row's own provenance). The service re-checks
 * the reason itself (trimmed, non-empty) BEFORE any mutation,
 * so a missing reason can never ride in past the DTO layer.
 */
export class InvalidateAnswerDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ReviewLearnedItemDto {
  @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ForgetCustomerMemoryDto {
  /** The memory's key: `channel:externalContactId` (SA-B5). */
  @IsString() @MinLength(1) @MaxLength(200) customerKey!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class SetAnswerStoreEnabledDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
