import { IsEnum, IsOptional } from "class-validator";

/** SA-B4: approval of a LearnedItem may choose the disclosure
 * class of the knowledge it becomes. Omitted = the conservative
 * per-kind/source default in LearningService (conversation- and
 * unanswered-sourced facts land internal; product_note is
 * always internal). */
export class ApproveLearnedItemDto {
  @IsOptional() @IsEnum(["public", "internal"]) visibility?: string;
}
