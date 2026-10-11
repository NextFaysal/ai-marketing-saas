import { IsBoolean, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateJobDto {
  @IsString() name!: string;
  @IsString() type!: string;
  @IsString() targetId!: string;
  // CX3: min 1 (was 5) — the 1-minute reply-debounce sweeps must be creatable.
  @IsNumber() @Min(1) intervalMinutes!: number;
}
export class UpdateJobDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(1) intervalMinutes?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
export class CreateRuleDto {
  @IsString() name!: string;
  @IsString() metric!: string;
  @IsString() comparator!: string;
  @IsString() threshold!: string;
  @IsString() action!: string;
  @IsOptional() @IsNumber() windowDays?: number;
  @IsOptional() @IsString() campaignPlanId?: string;
  @IsOptional() actionConfig?: { percent?: number; minDailyMinor?: number; maxDailyMinor?: number; cooldownHours?: number };
}
export class UpdateRuleDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
}
