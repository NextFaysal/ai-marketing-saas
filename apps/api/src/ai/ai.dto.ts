import { IsOptional, IsString, MaxLength } from "class-validator";
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
