import { IsArray, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
export class CreateLeadDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() value?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() nextFollowUpAt?: string;
  // CRM C4: values for the org's lead custom fields, keyed by def key.
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateLeadDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() value?: string | null;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() ownerUserId?: string | null;
  @IsOptional() @IsString() nextFollowUpAt?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsObject() customFields?: Record<string, unknown> | null;
}
export class AddNoteDto { @IsString() @MaxLength(2000) content!: string; }

export class MergeLeadDto { @IsString() sourceLeadId!: string; }

/** CRM C3: same body shape as the products/orders import DTO. */
export class ImportLeadsCsvDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsString() @MaxLength(2_000_000) csvText!: string;
}

/** CRM C5: the org's lead auto-assignment strategy
 * (off | round_robin | least_open_leads — validated in the
 * service so the error names the vocabulary). */
export class UpdateAssignmentSettingDto {
  @IsString() @MaxLength(40) strategy!: string;
}

/** CX10: per-stage follow-up default intervals in HOURS, keyed by
 * Lead stage — { "new": 24, "contacted": 72, ... }. Stage keys and
 * the 1..8760 hour range are validated in the service so the 400
 * can name the vocabulary (Bengali). null / {} clears all defaults.
 * The value type is deliberately loose here: a non-integer must
 * reach the service validator, not die as a generic DTO error. */
export class UpdateFollowUpDefaultsDto {
  @IsOptional() @IsObject() followUpDefaultsByStage?: Record<string, unknown> | null;
}
