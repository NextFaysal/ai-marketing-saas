import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

/** SA-B22 (T1): the closed vocabularies of a PlatformTeaching
 * row. `language` follows the house i18n shape (one text + a
 * language tag, cf. BusinessProfile.aiReplyLanguage); `kind` is
 * the teaching's flavour — all three are GUIDANCE, none of them
 * can carry facts about a shop (see the service header). */
export const TEACHING_LANGUAGES = ["bn", "en", "mixed"] as const;
export const TEACHING_KINDS = ["style", "policy", "guidance"] as const;

export class CreateTeachingDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
  @IsOptional() @IsIn(TEACHING_LANGUAGES) language?: string;
  @IsOptional() @IsIn(TEACHING_KINDS) kind?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class UpdateTeachingDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) content?: string;
  @IsOptional() @IsIn(TEACHING_LANGUAGES) language?: string;
  @IsOptional() @IsIn(TEACHING_KINDS) kind?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class SetTeachingEnabledDto {
  @IsBoolean() enabled!: boolean;
}
