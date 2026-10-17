import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * NF15 (FB5) — Agency console DTOs. Client-org creation reuses
 * the canonical CreateOrganizationDto from the organizations
 * module verbatim (same slug governance + ORG12 cap apply inside
 * OrganizationsService.create) — there is deliberately no
 * agency-specific creation DTO.
 */
export class CreateAgencyCommissionDto {
  @IsString() @MaxLength(120) clientOrganizationId!: string;
  @IsString() @MaxLength(40) periodLabel!: string;
  // Money is a minor-unit STRING (paisa) end to end — parsed to
  // BigInt in the service, never a float.
  @IsString() @MaxLength(40) amountMinor!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
