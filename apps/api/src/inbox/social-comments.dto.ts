import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListCommentsQueryDto {
  @IsOptional() @IsString() platform?: "facebook" | "instagram" | "tiktok" | "youtube";
  @IsOptional() @IsString() status?: "PENDING" | "AUTO_REPLIED" | "MANUALLY_REPLIED" | "HIDDEN" | "ESCALATED";
  @IsOptional() @IsString() sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "SPAM";
  @IsOptional() @IsString() intent?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

export class ReplyCommentDto {
  @IsString() replyText!: string;
  @IsOptional() @IsBoolean() sendPrivateDm?: boolean;
  @IsOptional() @IsString() privateDmText?: string;
}

export class GenerateAiReplyDto {
  @IsOptional() @IsString() tone?: "FRIENDLY_SALES" | "PROFESSIONAL" | "HELPFUL_SUPPORT";
  @IsOptional() @IsString() specificOfferContext?: string;
}

export class UpdateReplySettingsDto {
  @IsOptional() @IsBoolean() aiAutoReplyEnabled?: boolean;
  @IsOptional() @IsBoolean() sendPrivateDm?: boolean;
  @IsOptional() @IsBoolean() autoHideSpam?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(300) replyDelaySeconds?: number;
  @IsOptional() @IsString() tonePreference?: string;
  @IsOptional() @IsArray() bannedKeywords?: string[];
  @IsOptional() @IsString() salesOrderUrl?: string;
  @IsOptional() freeDeliveryThresholdMinor?: string;
}

export class IngestExternalCommentDto {
  @IsString() platform!: "facebook" | "instagram" | "tiktok" | "youtube";
  @IsString() externalPostId!: string;
  @IsString() externalCommentId!: string;
  @IsOptional() @IsString() postTitle?: string;
  @IsOptional() @IsString() postMediaUrl?: string;
  @IsString() authorName!: string;
  @IsOptional() @IsString() authorAvatarUrl?: string;
  @IsOptional() @IsString() authorSocialId?: string;
  @IsString() commentText!: string;
}
