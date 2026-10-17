import { IsBoolean, IsString, MaxLength, MinLength } from "class-validator";

/**
 * SA-B24 (Smart AI Phase 6, plan T3): kill-switch flip bodies.
 *
 * Every flip — pause AND resume, global AND per-org — carries
 * a non-empty `reason`. The reason is not decoration: a global
 * AI pause is the platform's emergency brake, and an
 * unexplained resume is how a pause gets silently lifted, so
 * AdminOversightService re-checks the reason itself (trimmed,
 * non-empty) BEFORE any state change, and the audit row stores
 * it verbatim (the SA-B23 fix discipline, applied to flips).
 */
export class SetGlobalPauseDto {
  @IsBoolean() paused!: boolean;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class SetOrgAiDisabledDto {
  @IsBoolean() disabled!: boolean;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
