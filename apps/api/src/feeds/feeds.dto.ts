import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** EC14: create a product feed. The token is generated
 * server-side (the feed URL is a secret URL); format defaults by
 * channel — meta/google → xml, tiktok → csv. */
export class CreateFeedDto {
  @IsIn(["meta", "google", "tiktok"]) channel!: string;
  @IsOptional() @IsIn(["xml", "csv"]) format?: string;
  @IsOptional() @IsBoolean() includeOutOfStock?: boolean;
  @IsOptional() @IsString() @MaxLength(300) defaultGoogleCategory?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateFeedDto {
  @IsOptional() @IsIn(["xml", "csv"]) format?: string;
  @IsOptional() @IsBoolean() includeOutOfStock?: boolean;
  @IsOptional() @IsString() @MaxLength(300) defaultGoogleCategory?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class SetFeedActiveDto {
  @IsBoolean() active!: boolean;
}
