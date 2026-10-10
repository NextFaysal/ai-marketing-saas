import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";

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
}
export class CreateWorkflowDto {
  @IsString() name!: string;
  @IsString() trigger!: string;
  @IsOptional() conditions?: unknown;
  @IsArray() steps!: any[];
}
export class UpdateWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
