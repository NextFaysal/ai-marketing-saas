import { IsOptional, IsString, MaxLength } from "class-validator";
export class CreateCompetitorDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() facebookPageId?: string;
  @IsOptional() @IsString() facebookPageUrl?: string;
  @IsOptional() @IsString() websiteUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class UpdateCompetitorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() facebookPageId?: string;
  @IsOptional() @IsString() facebookPageUrl?: string;
  @IsOptional() @IsString() websiteUrl?: string;
  @IsOptional() @IsString() notes?: string;
}
export class SyncAdsDto {
  @IsOptional() countries?: string[];
  @IsOptional() activeOnly?: boolean;
}
export class AddObservationDto {
  @IsString() @MaxLength(200) productName!: string;
  @IsString() price!: string;
  @IsOptional() @IsString() currency?: string;
  @IsString() sourceUrl!: string;
}
export class GenerateInsightsDto { @IsOptional() @IsString() competitorId?: string; }
