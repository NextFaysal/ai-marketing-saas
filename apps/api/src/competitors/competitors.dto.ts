import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

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
export class GenerateCounterAdDto {
  @IsString() competitorAdId!: string;
  @IsOptional() @IsString() ownProductId?: string;
  @IsOptional() @IsString() tone?: string;
}
export class SyncMultiPlatformDto {
  @IsOptional() platforms?: ("facebook" | "google" | "tiktok" | "bing")[];
  @IsOptional() countries?: string[];
  @IsOptional() activeOnly?: boolean;
}
export class GenerateSeoGapDto {
  @IsOptional() @IsString() ownProductId?: string;
}
export class DeconstructVideoScriptDto {
  @IsString() competitorAdId!: string;
  @IsOptional() @IsString() ownProductId?: string;
  @IsOptional() @IsString() videoStyle?: string;
}

export class ConfigureAlertSettingsDto {
  @IsOptional() @IsBoolean() telegramEnabled?: boolean;
  @IsOptional() @IsString() telegramBotToken?: string;
  @IsOptional() @IsString() telegramChatId?: string;
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsString() whatsappWebhookUrl?: string;
  @IsOptional() @IsBoolean() notifyOnPriceDrop?: boolean;
  @IsOptional() @IsBoolean() notifyOnStockOut?: boolean;
  @IsOptional() @IsBoolean() notifyOnWinningAd?: boolean;
}

export class TestAlertChannelDto {
  @IsString() channel!: "telegram" | "whatsapp";
  @IsOptional() @IsString() telegramBotToken?: string;
  @IsOptional() @IsString() telegramChatId?: string;
  @IsOptional() @IsString() whatsappWebhookUrl?: string;
}





