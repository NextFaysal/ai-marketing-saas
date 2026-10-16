import { IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  subject!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  @IsIn(["general", "billing", "technical", "campaigns", "integration"])
  category?: string;

  @IsOptional()
  @IsIn(["normal", "high", "urgent"])
  priority?: string;

  @IsOptional()
  @IsArray()
  attachments?: Array<{ name: string; url: string; size?: number; mimeType?: string }>;

  @IsOptional()
  @IsObject()
  diagnostics?: Record<string, unknown>;
}

export class ReplyDto {
  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsArray()
  attachments?: Array<{ name: string; url: string; size?: number; mimeType?: string }>;
}

export class InternalNoteDto {
  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsArray()
  attachments?: Array<{ name: string; url: string; size?: number; mimeType?: string }>;
}

export class TenantStatusDto {
  @IsIn(["closed", "open"])
  status!: string;
}

export class CsatDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}

export class AdminTicketUpdateDto {
  @IsOptional()
  @IsIn(["open", "pending", "in_progress", "resolved", "closed"])
  status?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string | null;

  @IsOptional()
  @IsIn(["normal", "high", "urgent"])
  priority?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  slaDueAt?: string;
}

export class UploadAttachmentDto {
  @IsString()
  @MaxLength(8_000_000)
  dataBase64!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contentType?: string;
}

export class CannedResponseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  shortcut!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class SuggestSolutionsDto {
  @IsString()
  subject!: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
