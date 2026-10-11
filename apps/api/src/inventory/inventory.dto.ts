import { IsInt, IsOptional, IsString, MaxLength } from "class-validator";

export class StockAdjustmentDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsInt() delta?: number;
  @IsOptional() @IsInt() setTo?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
