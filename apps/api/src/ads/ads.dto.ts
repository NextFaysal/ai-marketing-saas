import { IsArray, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
export class CreateAdAccountDto {
  @IsString() platform!: string; // meta | google | tiktok | manual
  @IsOptional() @IsString() sourceType?: string; // api | csv | manual
  @IsOptional() @IsString() @MaxLength(100) externalId?: string;
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsString() currency?: string;
}
export class ManualMetricDto {
  @IsString() date!: string; // YYYY-MM-DD
  @IsString() spend!: string; // decimal string
  @IsOptional() @IsString() impressions?: string;
  @IsOptional() @IsString() clicks?: string;
  @IsOptional() @IsString() conversions?: string;
  @IsOptional() @IsString() conversionValue?: string;
  @IsOptional() @IsString() @MaxLength(200) campaignName?: string;
}
export class ImportAdCsvDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsString() @MaxLength(2_000_000) csvText!: string;
}
export class MetaConnectDto {
  @IsString() @MinLength(10) accessToken!: string;
  @IsOptional() @IsArray() adAccountExternalIds?: string[]; // omit = connect all discovered accounts
}
export class MetaSyncDto {
  @IsOptional() @IsString() since?: string; // YYYY-MM-DD
  @IsOptional() @IsString() until?: string;
}

export class GoogleConnectDto {
  @IsString() customerId!: string;
  @IsString() clientId!: string;
  @IsString() clientSecret!: string;
  @IsString() refreshToken!: string;
  @IsString() developerToken!: string;
  @IsOptional() @IsString() loginCustomerId?: string;
}
export class TikTokConnectDto {
  @IsString() advertiserId!: string;
  @IsString() accessToken!: string;
}
export class RangeSyncDto {
  @IsOptional() @IsString() since?: string;
  @IsOptional() @IsString() until?: string;
}
