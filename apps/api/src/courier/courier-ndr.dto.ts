import { IsIn, IsISO8601, IsOptional, IsString } from "class-validator";

export class ContactNdrDto {
  @IsOptional()
  @IsIn(["whatsapp", "sms", "both"])
  channel?: "whatsapp" | "sms" | "both";

  @IsOptional()
  @IsString()
  customMessage?: string;
}

export class RescheduleNdrDto {
  @IsISO8601()
  rescheduleDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class ResolveNdrDto {
  @IsIn(["RESOLVED", "RETURNED", "CANCELLED", "RESCHEDULED"])
  resolution!: "RESOLVED" | "RETURNED" | "CANCELLED" | "RESCHEDULED";

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CustomerNdrActionDto {
  @IsIn(["CONFIRMED_TOMORROW", "CHANGE_ADDRESS", "CANCEL_ORDER"])
  action!: "CONFIRMED_TOMORROW" | "CHANGE_ADDRESS" | "CANCEL_ORDER";

  @IsOptional()
  @IsString()
  newAddress?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsISO8601()
  preferredDate?: string;
}
