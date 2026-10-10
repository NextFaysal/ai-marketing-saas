import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";
export class CreateLeadDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() value?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() nextFollowUpAt?: string;
}
export class UpdateLeadDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() value?: string | null;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() ownerUserId?: string | null;
  @IsOptional() @IsString() nextFollowUpAt?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}
export class AddNoteDto { @IsString() @MaxLength(2000) content!: string; }

export class MergeLeadDto { @IsString() sourceLeadId!: string; }
