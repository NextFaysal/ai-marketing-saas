import { IsOptional, IsString, MaxLength } from "class-validator";

/** OU3: Daraz per-org app credentials. The secret and tokens are
 * sealed server-side (AES-256-GCM) and never returned. */
export class SaveDarazConfigDto {
  @IsString() @MaxLength(200) appKey!: string;
  @IsString() @MaxLength(500) appSecret!: string;
  @IsOptional() @IsString() @MaxLength(2000) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(2000) refreshToken?: string;
}
