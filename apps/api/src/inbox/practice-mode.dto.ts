import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class StartPracticeSessionDto {
  @IsOptional()
  @IsString()
  scenarioId?: string;

  @IsOptional()
  @IsIn(["whatsapp", "messenger", "webchat"])
  channel?: string;
}

export class PracticeMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;
}

export class CompletePracticeSessionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}
