import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";
export class CreateOrganizationDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[a-z0-9-]+$/) @MinLength(3) @MaxLength(60) slug!: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}
export class InviteMemberDto {
  @IsEmail() email!: string;
  @IsString() role!: string; // validated against invitable roles in the service
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
}
