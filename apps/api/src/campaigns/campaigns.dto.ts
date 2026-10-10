import { IsArray, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
export class CreatePlanDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() objective!: string;
  @IsString() adAccountId!: string;
}
export class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() objective?: string;
}
export class AddAdSetDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() dailyBudget?: string;
  @IsOptional() @IsString() lifetimeBudget?: string;
  @IsString() optimizationGoal!: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsArray() countries!: string[];
  @IsOptional() @IsNumber() ageMin?: number;
  @IsOptional() @IsNumber() ageMax?: number;
  @IsOptional() @IsArray() genders?: number[];
  @IsOptional() @IsArray() interests?: string[];
  @IsOptional() @IsArray() customAudienceIds?: string[];
  @IsOptional() @IsArray() excludedAudienceIds?: string[];
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
}
export class CarouselCardDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() linkUrl!: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() imageAssetId?: string;
}
export class AddAdDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(5000) primaryText!: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() description?: string;
  @IsString() linkUrl!: string;
  @IsOptional() @IsString() callToAction?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsString() imageAssetId?: string;
  @IsOptional() @IsString() videoAssetId?: string;
  @IsOptional() @IsArray() carouselCards?: CarouselCardDto[];
}
export class InstantiateBlueprintDto {
  @IsString() blueprintKey!: string;
  @IsString() adAccountId!: string;
  @IsOptional() @IsString() productId?: string;
}
export class RejectDto { @IsString() @MaxLength(500) reason!: string; }
export class GenerateCopyDto {
  @IsString() adSetId!: string;
  @IsString() productId!: string;
  @IsOptional() @IsString() linkUrl?: string;
}
