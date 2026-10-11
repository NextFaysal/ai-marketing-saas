import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
export class GenerateReportDto {
  @IsOptional() @IsString() type?: string; // daily | weekly | monthly
  @IsOptional() @IsString() date?: string; // anchor date YYYY-MM-DD (period ends this day)
  @IsOptional() @IsString() language?: string; // bn | en
}
export class CreateConversationDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
}
export class SendMessageDto {
  @IsString() @MaxLength(8000) content!: string;
}
export class UpdateRecommendationDto {
  @IsString() status!: string; // open | done | dismissed
}
export class UpdateConversationDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
export class UpdateProactiveSettingsDto {
  // @IsBoolean is load-bearing: with forbidNonWhitelisted the M40
  // FlagDto incident showed a missing decorator silently 400s.
  @IsOptional() @IsBoolean() briefingEnabled?: boolean;
  @IsOptional() @IsBoolean() anomalyAlertsEnabled?: boolean;
}
export class GenerateCreativeDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() @MaxLength(200) goal?: string;
  @IsOptional() @IsString() @MaxLength(60) tone?: string;
  @IsOptional() @IsString() language?: string;
}
export class CreateCreativeDraftDto {
  @IsString() productId!: string;
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) headline!: string;
  @IsString() @MaxLength(5000) primaryText!: string;
  @IsOptional() @IsString() @MaxLength(40) callToAction?: string;
  @IsOptional() @IsString() @MaxLength(1000) linkUrl?: string;
}
export class CreateProposalDto {
  @IsString() type!: string; // pause_campaign | pause_ad_set | create_broadcast_draft
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() adSetId?: string;
  @IsOptional() @IsString() recommendationId?: string;
  // broadcast draft fields
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(8000) body?: string;
  @IsOptional() @IsString() audienceType?: string;
  @IsOptional() @IsString() audienceStage?: string;
  @IsOptional() @IsString() audienceSegment?: string;
  @IsOptional() @IsString() whatsappTemplateId?: string;
}
