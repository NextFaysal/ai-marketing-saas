import { IsInt, IsObject, IsOptional, IsString } from "class-validator";

/** SA-B10 (W1): staff-side propose over the Action Engine. The
 *  payload is validated for real by the catalog action's builder
 *  (org-scoped target checks + preview), so it stays a free object
 *  here — same discipline as the Milestone-47 proposal DTO. */
export class CreateActionProposalDto {
  @IsString()
  actionId!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional() @IsObject()
  sourceRef?: Record<string, unknown>;
}

export class SetAutonomyDto {
  @IsInt()
  level!: number;
}
