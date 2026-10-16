import { IsIn, IsInt, IsOptional, IsString, MaxLength } from "class-validator";
import { ADJUSTMENT_REASONS } from "./inventory.service";

export class StockAdjustmentDto {
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsInt() delta?: number;
  @IsOptional() @IsInt() setTo?: number;
  // GB2 (GC7): NEW merchant channel for the adjustment reason —
  // before GB2 this DTO had no reason field at all, so merchant
  // adjustments always landed as "manual_adjustment". The reason
  // is constrained to the merchant vocabulary; system flows call
  // adjust() directly with their own reasons.
  @IsOptional() @IsIn([...ADJUSTMENT_REASONS]) reason?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  // AB3 (AX4): optional explicit bin the adjustment posts to
  // (damage/lost picker, bin-scoped counts). Validated against
  // the org in InventoryService.adjust; without it the delta
  // posts to the resolved default bin.
  @IsOptional() @IsString() binId?: string;
}
