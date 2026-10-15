import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
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
  // CC28: which Meta app this token was minted under — "own"
  // requires the tenant's Meta app config (TenantAppConfig);
  // recorded on the Integration row (AdAccount has no appSource
  // column). Nothing in the ads module resolves an app secret
  // downstream today — the value is the honest record of which
  // app the token belongs to (see the B12 acceptance).
  @IsOptional() @IsIn(["platform", "own"]) appSource?: string;
}
// AD5: step 1 of the picker flow — verify a Meta token and list the
// accounts under it WITHOUT storing anything (no Integration, no
// credential, no audit). The token is used for this call only.
export class MetaDiscoverDto {
  @IsString() @MinLength(10) accessToken!: string;
}
// AD5: per-account settings PATCH. syncDisabled toggles every
// platform-data sync path for the account (manual + scheduled).
export class UpdateAccountSettingsDto {
  @IsOptional() @IsBoolean() syncDisabled?: boolean;
  // AD6: display label. null or "" clears it; the 60-char cap is
  // enforced in the service (after trimming), the DTO only bounds
  // the raw payload.
  @IsOptional() @IsString() @MaxLength(200) label?: string | null;
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
// AD4: spend-watch settings. dailyCap is a decimal string in the
// account's currency ("5000.50"); null clears it. anomalyPct null = off.
export class UpdateSpendWatchDto {
  @IsOptional() enabled?: boolean;
  @IsOptional() dailyCap?: string | null;
  @IsOptional() anomalyPct?: number | null;
}
