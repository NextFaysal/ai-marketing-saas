import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ConfigureProductCycleDto {
  @IsNumber()
  @Min(1)
  replenishmentDays!: number;

  @IsOptional()
  @IsString()
  replenishmentReminderText?: string;
}

export class SendReplenishmentReminderDto {
  @IsOptional()
  @IsString()
  customMessage?: string;

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class MarkReorderedDto {
  @IsOptional()
  @IsString()
  reorderOrderId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
