import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

/**
 * AB7 (AX17) — staff update for the org's social-proof popup
 * setting. All fields optional (partial upsert). Ranges are
 * declared here for the global ValidationPipe AND re-checked in
 * SocialProofService (specs and non-HTTP callers bypass the pipe).
 *
 * minTotalMinor is a paisa amount carried as a STRING of digits
 * (the codebase's BigInt-as-string convention); null clears the
 * threshold. @IsOptional skips the other validators for null.
 */
export class UpdateSocialProofSettingDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) lookbackHours?: number;
  @IsOptional() @IsInt() @Min(5) @Max(300) intervalSec?: number;
  @IsOptional() @IsInt() @Min(2) @Max(30) displaySec?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxPerSession?: number;
  @IsOptional() @IsString() @Matches(/^\d+$/) minTotalMinor?: string | null;
}
