import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
export class CreatePolicyDto {
  @IsEnum(["shipping", "delivery", "refund", "return", "cancellation", "payment", "custom"]) type!: string;
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(2) @MaxLength(10000) content!: string;
}
export class UpdatePolicyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(10000) content?: string;
}
export class CreateKnowledgeDocDto {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(2) @MaxLength(10000) content!: string;
  @IsOptional() @IsEnum(["faq", "note", "claim", "template", "file_doc"]) kind?: string;
}

export class IngestKnowledgeFileDto {
  @IsString() @MinLength(1) @MaxLength(255) filename!: string;
  @IsString() dataBase64!: string;
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsEnum(["faq", "note", "claim", "template", "file_doc"]) kind?: string;
}
