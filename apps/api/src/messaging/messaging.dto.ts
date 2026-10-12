import { IsArray, IsBoolean, IsInt, IsOptional, IsString } from "class-validator";

export class CreateTemplateDto {
  @IsString() name!: string;
  @IsString() channel!: string;
  @IsOptional() @IsString() subject?: string;
  @IsString() body!: string;
}
export class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() body?: string;
}
export class CreateBroadcastDto {
  @IsString() name!: string;
  @IsString() channel!: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() body?: string;
  @IsString() audienceType!: string;
  @IsOptional() @IsString() audienceStage?: string;
  @IsOptional() @IsString() whatsappTemplateId?: string;
  @IsOptional() @IsArray() templateParams?: string[];
  @IsOptional() @IsString() audienceSegment?: string;
  @IsOptional() abTest?: boolean;
  @IsOptional() @IsString() abSubject?: string;
  @IsOptional() @IsString() abBody?: string;
  @IsOptional() @IsString() abWhatsappTemplateId?: string;
  // CX10: exclusions & opt-out
  @IsOptional() @IsInt() excludePastDays?: number;
  @IsOptional() @IsBoolean() excludeOptOut?: boolean;
}

export class PreviewAudienceDto {
  @IsString() channel!: string;
  @IsString() audienceType!: string;
  @IsOptional() @IsString() audienceStage?: string;
  @IsOptional() @IsString() audienceSegment?: string;
  @IsOptional() @IsInt() excludePastDays?: number;
  @IsOptional() @IsBoolean() excludeOptOut?: boolean;
}
export class CreateWorkflowDto {
  @IsString() name!: string;
  @IsString() trigger!: string;
  @IsOptional() conditions?: unknown;
  @IsArray() steps!: any[];
  // Workflows W6 governance (settable at create too).
  @IsOptional() @IsInt() cooldownMinutes?: number;
  @IsOptional() @IsInt() dailyRunCap?: number | null;
}
export class UpdateWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  // Workflows W1: the definition itself is editable now,
  // validated exactly like create.
  @IsOptional() @IsString() trigger?: string;
  @IsOptional() conditions?: unknown;
  @IsOptional() @IsArray() steps?: any[];
  // Workflows W6 governance.
  @IsOptional() @IsInt() cooldownMinutes?: number;
  @IsOptional() @IsInt() dailyRunCap?: number | null;
}
