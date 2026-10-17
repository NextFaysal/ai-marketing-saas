import { Type } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

/** One client-carried history turn (SA-B21: the copilot is
 *  stateless by design — the client passes the recent turns it
 *  wants the model to see; nothing is stored server-side). */
export class CopilotHistoryTurnDto {
  @IsIn(["user", "assistant"]) role!: string;
  @IsString() @MaxLength(1000) content!: string;
}

/**
 * SA-B21 (Smart AI Phase 5, G3): one ask to the Owner Copilot.
 * `question` is free text (bn or en) — a business question
 * answered from the org's own deterministic digests + Brain, or
 * an action request the deterministic intent layer resolves
 * against the Action Engine catalog. `language` pins the answer
 * language; absent, the org's aiReplyLanguage (else bn) rules.
 */
export class CopilotAskDto {
  @IsString() @MaxLength(2000) question!: string;
  @IsOptional() @IsIn(["bn", "en"]) language?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CopilotHistoryTurnDto)
  history?: CopilotHistoryTurnDto[];
}
