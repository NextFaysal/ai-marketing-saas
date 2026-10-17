import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * SA-B19 (Smart AI Phase 5, G1): AI social content generation.
 * Exactly one topic source per call:
 *  - "product"      — an own LIVE product row (productId);
 *                     its price joins the fact pack ONLY when
 *                     includePrice is true.
 *  - "learned_item" — an APPROVED LearnedItem (learnedItemId):
 *                     a creative pattern (SA-B16), a competitor
 *                     counter-idea (SA-B18) or a performance
 *                     fact (SA-B5). Suggested items are refused.
 *  - "topic"        — a free topic string from staff.
 * Every surviving variant becomes a REAL draft post on
 * socialAccountId through SocialService.createPost — never
 * scheduled, never published by the generator.
 */
export class GenerateContentDto {
  @IsIn(["product", "learned_item", "topic"]) sourceType!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsBoolean() includePrice?: boolean;
  @IsOptional() @IsString() learnedItemId?: string;
  @IsOptional() @IsString() @MaxLength(500) topic?: string;
  @IsString() socialAccountId!: string;
  @IsOptional() @IsIn(["bn", "en"]) language?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) count?: number;
}
