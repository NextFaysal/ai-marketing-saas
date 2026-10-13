import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
export class GenerateReportDto {
  @IsOptional() @IsString() type?: string; // daily | weekly | monthly
  @IsOptional() @IsString() date?: string; // anchor date YYYY-MM-DD (period ends this day)
  @IsOptional() @IsString() language?: string; // bn | en
}
export class CreateConversationDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  // AP7: specialist persona for the new conversation.
  @IsOptional() @IsIn(["general", "ads_analyst", "inbox_coach", "finance_analyst"]) persona?: string;
}
/** G6: the record the user attached via the @-mention picker.
 *  Carries only a type + opaque id; the server loads the facts
 *  itself, org-scoped — entity facts never round-trip from the
 *  client (security-first, per the v2 plan). */
export class EntityContextDto {
  @IsIn(["order", "customer", "product", "campaign"])
  type!: "order" | "customer" | "product" | "campaign";

  @IsString()
  @MaxLength(64)
  id!: string;
}

/** AP2: a file/image the user attached to this message, already
 *  processed by POST ai/chat/attachments — documents carry their
 *  extracted text, images carry the vision description. Stored on
 *  the user message so the citation stays honest after reload. */
export class ChatAttachmentDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(["file", "image"])
  kind!: "file" | "image";

  @IsString()
  @MaxLength(12000)
  text!: string;
}

export class SendMessageDto {
  @IsString() @MaxLength(8000) content!: string;
  // Global Assistant (2026-10-12): the dashboard section the user is
  // viewing, sent as a route path only (never free text). Used solely
  // as a compose-time interpretation hint — never stored on the
  // message. The service re-validates the shape (defense in depth).
  @IsOptional() @IsString() @MaxLength(120)
  @Matches(/^\/dashboard(\/[a-z0-9-]+)*$/)
  pageContext?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EntityContextDto)
  entity?: EntityContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatAttachmentDto)
  attachment?: ChatAttachmentDto;
}
export class UpdateRecommendationDto {
  @IsString() status!: string; // open | done | dismissed
}
export class UpdateConversationDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsIn(["general", "ads_analyst", "inbox_coach", "finance_analyst"]) persona?: string;
}
export class UpdateProactiveSettingsDto {
  // @IsBoolean is load-bearing: with forbidNonWhitelisted the M40
  // FlagDto incident showed a missing decorator silently 400s.
  @IsOptional() @IsBoolean() briefingEnabled?: boolean;
  @IsOptional() @IsBoolean() anomalyAlertsEnabled?: boolean;
  // CX12b (12e): email copy of the daily briefing (default OFF).
  @IsOptional() @IsBoolean() dailyReportEmailEnabled?: boolean;
  // AP6: Telegram copy of the daily briefing (default OFF).
  @IsOptional() @IsBoolean() telegramBriefEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(40) telegramBriefChatId?: string;
  // AP7: autonomy level (0|2) + per-tenant assistant name.
  @IsOptional() @IsInt() @Min(0) @Max(2) autonomyLevel?: number;
  @IsOptional() @IsString() @MaxLength(60) assistantName?: string;
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
  // AP5 fields
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) content?: string;
  // EC11 commerce proposal fields
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() listingId?: string;
  @IsOptional() @IsString() newPrice?: string;
  @IsOptional() @IsInt() newQuantity?: number;
  @IsOptional() @IsInt() delta?: number;
  @IsOptional() @IsString() @MaxLength(80) discountCode?: string;
  @IsOptional() @IsString() discountKind?: string;
  @IsOptional() @IsInt() discountValue?: number;
  @IsOptional() @IsString() discountMinOrderMinor?: string;
  @IsOptional() @IsInt() discountUsageLimit?: number;
}

export class BulkApproveDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  ids!: string[];
}

export class CreateSavedPromptDto {
  @IsString() @MaxLength(80) title!: string;
  @IsString() @MaxLength(2000) body!: string;
}
export class UpdateSavedPromptDto {
  @IsOptional() @IsString() @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) body?: string;
}

export class CreateAssistantApiKeyDto {
  @IsString() @MaxLength(80) name!: string;
}

export class AssistantApiChatDto {
  @IsString() @MaxLength(4000) content!: string;
  @IsOptional() @IsString() conversationId?: string;
  @IsOptional() @IsIn(["general", "ads_analyst", "inbox_coach", "finance_analyst"]) persona?: string;
}
