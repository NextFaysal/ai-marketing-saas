import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
export class ConnectMessagingDto {
  @IsString() channel!: string;
  @IsString() accessToken!: string;
  // Optional since Milestone 33: tenants connecting under the
  // operator's platform Meta app omit it; verification then falls
  // back to the platform app secret.
  @IsOptional() @IsString() appSecret?: string;
  @IsString() verifyToken!: string;
  @IsOptional() @IsString() phoneNumberId?: string;
  @IsOptional() @IsString() pageId?: string;
}
export class SendMessageDto { @IsString() @MaxLength(4096) content!: string; }
export class UpdateConversationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assignedUserId?: string | null;
  @IsOptional() @IsBoolean() spamFlag?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsBoolean() autoReplyPaused?: boolean;
  // Unified Inbox U5: pipeline + close outcome.
  @IsOptional() @IsString() pipelineStage?: string;
  @IsOptional() @IsString() outcome?: string | null;
  @IsOptional() @IsString() @MaxLength(300) outcomeReason?: string | null;
}
export class RefundRequestDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class SendDraftDto { @IsOptional() @IsString() @MaxLength(4096) content?: string; }

export class AddNoteDto { @IsString() @MaxLength(4000) content!: string; }
export class QuickReplyDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(4000) content!: string;
}
export class WhatsAppTemplateDto {
  @IsString() @MaxLength(512) name!: string;
  @IsOptional() @IsString() @MaxLength(10) language?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(2000) bodyText?: string;
}
export class SendTemplateDto {
  @IsString() templateId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
}
export class SendImageDto {
  @IsString() @MaxLength(2000) imageUrl!: string;
  @IsOptional() @IsString() @MaxLength(1024) caption?: string;
}

export class UpdateInboxSettingsDto {
  @IsOptional() @IsString() autoReplyMode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) confidenceThreshold?: number;
  @IsOptional() @IsObject() perIntent?: Record<string, string>;
  @IsOptional() @IsString() smartAssign?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10080) slaFirstResponseMinutes?: number;
  @IsOptional() @IsBoolean() botEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) botDeliveryChargeMinor?: number | null;
  @IsOptional() @IsInt() @Min(5) @Max(10080) reassignAfterMinutes?: number | null;
  @IsOptional() @IsString() escalationTeamId?: string | null;
  @IsOptional() @IsObject() perChannelModes?: Record<string, string>;
  @IsOptional() @IsInt() @Min(0) escalationThresholdMinor?: number | null;
  @IsOptional() @IsInt() @Min(7) @Max(3650) retentionDays?: number | null;
}
export class CodConfirmationDto { @IsString() orderId!: string; }

export class CreateChatOrderItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
}
export class CreateChatOrderDto {
  @IsArray() items!: CreateChatOrderItemDto[];
  @IsOptional() @IsInt() @Min(0) shippingMinor?: number;
  @IsOptional() @IsBoolean() isCod?: boolean;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
}
export class TranslateMessageDto { @IsString() target!: string; }

// Unified Inbox U2: teams + agent state.
export class TeamDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[];
}
export class UpdateTeamDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[];
}
export class TeamMemberInputDto {
  @IsString() userId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) capacity?: number;
}
export class TeamMembersDto {
  @IsArray() members!: TeamMemberInputDto[];
}
export class AgentStateDto {
  @IsString() status!: string;
}

// Unified Inbox U4: channel connects.
export class ConnectTelegramDto {
  @IsString() @MinLength(10) @MaxLength(200) botToken!: string;
}
export class ConnectEmailDto {
  @IsString() @MaxLength(200) imapHost!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) imapPort?: number;
  @IsString() @MaxLength(200) smtpHost!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsString() @MaxLength(200) user!: string;
  @IsString() @MinLength(1) @MaxLength(400) password!: string;
}
