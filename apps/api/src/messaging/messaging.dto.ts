import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateTemplateDto {
  @IsString() name!: string;
  @IsString() channel!: string;
  @IsOptional() @IsString() subject?: string;
  @IsString() body!: string;
  // MS5: optional HTML part (email only; the service 400s on sms).
  @IsOptional() @IsString() htmlBody?: string;
}
export class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() htmlBody?: string;
}
export class CreateBroadcastDto {
  @IsString() name!: string;
  @IsString() channel!: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() body?: string;
  // MS5: optional HTML part (email only; the service 400s on
  // sms/whatsapp). From a template, htmlBody comes from the
  // template instead.
  @IsOptional() @IsString() htmlBody?: string;
  @IsString() audienceType!: string;
  @IsOptional() @IsString() audienceStage?: string;
  @IsOptional() @IsString() whatsappTemplateId?: string;
  @IsOptional() @IsArray() templateParams?: string[];
  // MS6: rich WhatsApp template parameters ({ headerMediaUrl?,
  // headerTextParams?, buttonParams? }) — shape-only typing here;
  // the VALUES are validated in the service (400 on a non-http(s)
  // headerMediaUrl, a bad button index/subType, or when the
  // channel is not whatsapp).
  @IsOptional() templateComponents?: { headerMediaUrl?: string; headerTextParams?: string[]; buttonParams?: { index: number; subType: "url" | "quick_reply"; text?: string; payload?: string }[] };
  @IsOptional() @IsString() audienceSegment?: string;
  @IsOptional() abTest?: boolean;
  @IsOptional() @IsString() abSubject?: string;
  @IsOptional() @IsString() abBody?: string;
  @IsOptional() @IsString() abWhatsappTemplateId?: string;
  // CX10: drop recipients who already got a confirmed delivery
  // from an earlier broadcast of this org (A/B variants inherit).
  @IsOptional() @IsBoolean() excludePreviousRecipients?: boolean;
  // Owner CX10 variant (his series): time-window + opt-out exclusions.
  @IsOptional() @IsInt() excludePastDays?: number;
  @IsOptional() @IsBoolean() excludeOptOut?: boolean;
  // MS1: create the broadcast already scheduled (future ISO time).
  @IsOptional() @IsString() scheduledAt?: string;
  // MS3: the new audience types. audienceDefinition is validated
  // strictly by the pure audience-rules module in the service;
  // audienceCsv accepts a pasted string OR a string array.
  @IsOptional() audienceDefinition?: unknown;
  @IsOptional() @IsString() audienceSavedId?: string;
  @IsOptional() audienceCsv?: unknown;
  // MS8: recurrence ({ freq, interval, weekdays?, endsAt? }) —
  // shape-only typing here; the VALUES are validated strictly by
  // messaging/recurrence.ts in the service (400 on bad shape).
  @IsOptional() recurrence?: unknown;
}

/** MS1: set/move a schedule (ISO time), or cancel it (null). */
export class ScheduleBroadcastDto {
  @IsOptional() scheduledAt?: string | null;
  // MS8: when present, set/replace the recurrence alongside the
  // schedule; explicit null clears it; absent leaves it as-is.
  @IsOptional() recurrence?: unknown;
}

/** MS8: install a messaging journey preset (optional rename). */
export class InstallJourneyPresetDto {
  @IsOptional() @IsString() name?: string;
}

/** MS9: AI copy draft request. Drafts are RETURNED ONLY — the
 * DTO has no save/send target by design. */
export class AiDraftDto {
  @IsString() channel!: string;
  @IsString() goal!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() audienceHint?: string;
  @IsOptional() @IsString() language?: string;
}

/** MS9: AI subject-line variants (same usage feature as drafts). */
export class AiSubjectsDto {
  @IsString() subject!: string;
  @IsOptional() @IsString() goal?: string;
}

/** MS10: edit a broadcast (draft/scheduled/paused only — the
 * service enforces the status matrix and reuses create-time
 * validation; null clears templateId / htmlBody / the schedule
 * exactly where create semantics allow it). */
export class UpdateBroadcastDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() subject?: string | null;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() htmlBody?: string | null;
  @IsOptional() @IsString() templateId?: string | null;
  @IsOptional() @IsString() whatsappTemplateId?: string;
  @IsOptional() @IsArray() templateParams?: string[];
  // Shape-only typing; values validated by the shared service
  // validator (same as create).
  @IsOptional() templateComponents?: unknown;
  @IsOptional() scheduledAt?: string | null;
}

/** MS2: per-org messaging consent settings. The service re-validates
 * strictly (cap integer 0..20); these decorators are the first gate. */
export class UpdateMessagingSettingDto {
  @IsOptional() @IsInt() @Min(0) @Max(20) frequencyCapPerDay?: number;
  @IsOptional() @IsBoolean() whatsappOptInRequired?: boolean;
  // MS5: broadcast link tracking (UTM + signed redirect wrap).
  @IsOptional() @IsBoolean() linkTrackingEnabled?: boolean;
}

/** MS5: test-send a broadcast / template to one address. */
export class TestSendDto {
  @IsString() to!: string;
}

/** MS5: advisory compose check (never blocks a send). */
export class ComposeCheckDto {
  @IsString() channel!: string;
  @IsOptional() @IsString() subject?: string;
  @IsString() body!: string;
}

export class AddPreferenceDto {
  @IsString() channel!: string;
  @IsString() address!: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() note?: string;
}

export class ImportPreferencesDto {
  @IsString() channel!: string;
  @IsArray() addresses!: string[];
}

/** CX10: preview the audience of a not-yet-created broadcast.
 * Same fields the create form holds; the response carries counts
 * + a masked sample only (never full addresses, never ids).
 * MS3 adds the new audience fields; MS4 adds `body` (the form's
 * current message text, used only for the SMS-parts cost
 * estimate — never stored). */
export class PreviewBroadcastDto {
  @IsString() channel!: string;
  @IsString() audienceType!: string;
  @IsOptional() @IsString() audienceStage?: string;
  @IsOptional() @IsString() audienceSegment?: string;
  @IsOptional() @IsBoolean() excludePreviousRecipients?: boolean;
  // Owner CX10 variant fields (his series).
  @IsOptional() @IsInt() excludePastDays?: number;
  @IsOptional() @IsBoolean() excludeOptOut?: boolean;
  @IsOptional() audienceDefinition?: unknown;
  @IsOptional() @IsString() audienceSavedId?: string;
  @IsOptional() audienceCsv?: unknown;
  @IsOptional() @IsString() body?: string;
}

// ---------- MS3: saved audiences ----------
export class CreateSavedAudienceDto {
  @IsString() name!: string;
  // Validated strictly by audience-rules in the service.
  definition!: unknown;
}
export class UpdateSavedAudienceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() definition?: unknown;
}

// ---------- MS4: per-tenant senders ----------
export class UpdateTenantEmailDto {
  @IsOptional() @IsString() smtpHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsString() smtpUser?: string;
  @IsOptional() @IsString() smtpPass?: string;
  @IsOptional() @IsString() fromAddress?: string;
  @IsOptional() @IsString() fromName?: string;
  @IsOptional() @IsString() dkimSelector?: string;
  @IsOptional() @IsBoolean() clear?: boolean;
}
export class UpdateTenantSmsDto {
  @IsOptional() @IsString() smsGateway?: string;
  @IsOptional() @IsString() smsApiKey?: string;
  @IsOptional() @IsString() smsSenderId?: string;
  @IsOptional() @IsString() smsApiUrl?: string;
  @IsOptional() @IsBoolean() clear?: boolean;
}
export class UpdateSenderRatesDto {
  @IsOptional() @IsInt() @Min(0) smsCostPerPartMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) whatsappCostPerMessageMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) emailCostPerMessageMinor?: number | null;
}
export class SendTestEmailDto {
  @IsString() to!: string;
}
export class CreateWorkflowDto {
  @IsString() name!: string;
  @IsString() trigger!: string;
  @IsOptional() conditions?: unknown;
  @IsArray() steps!: any[];
  // Workflows W6 governance (settable at create too).
  @IsOptional() @IsInt() cooldownMinutes?: number;
  @IsOptional() @IsInt() dailyRunCap?: number | null;
}
export class UpdateWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  // Workflows W1: the definition itself is editable now,
  // validated exactly like create.
  @IsOptional() @IsString() trigger?: string;
  @IsOptional() conditions?: unknown;
  @IsOptional() @IsArray() steps?: any[];
  // Workflows W6 governance.
  @IsOptional() @IsInt() cooldownMinutes?: number;
  @IsOptional() @IsInt() dailyRunCap?: number | null;
}

/** Owner-series alias: his controller validates preview requests
 * with this name; same fields as PreviewBroadcastDto. */
export class PreviewAudienceDto extends PreviewBroadcastDto {}
