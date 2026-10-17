import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class CreateTemplateDto {
  @IsString() name!: string;
  @IsString() channel!: string;
  @IsOptional() @IsString() subject?: string;
  // MX7: body is optional at the DTO level because a block-built
  // template renders its body from `blocks`; the SERVICE still
  // requires a body whenever blocks are absent (same 400 path as
  // broadcasts — it validates the effective content).
  @IsOptional() @IsString() body?: string;
  // MS5: optional HTML part (email only; the service 400s on sms).
  @IsOptional() @IsString() htmlBody?: string;
  // MX7: block-builder source (email only) — shape-only typing;
  // validated strictly by messaging/email-blocks.ts in the service.
  @IsOptional() blocks?: unknown;
}
export class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() htmlBody?: string;
  // MX7: block-builder source (email only); explicit null detaches.
  @IsOptional() blocks?: unknown;
}

/** MX7: content-library saved block — one validated email block. */
export class CreateContentBlockDto {
  @IsString() name!: string;
  // Required (one validated email block); shape validated in the service.
  block!: unknown;
}
export class UpdateContentBlockDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() block?: unknown;
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
  // MX10: optional topic tag — recipients whose preference-center
  // topics exclude it are dropped at resolve time.
  @IsOptional() @IsString() topic?: string;
  // MX11: holdout percentage — a deterministic bucket of the
  // resolved audience held out of the send for comparison
  // (the service re-validates the 1–50 range strictly).
  @IsOptional() @IsInt() @Min(1) @Max(50) holdoutPercent?: number;
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
  // SA-B20 (G2) + MX8: ONE input, two consumers — the G2
  // personalisation config ({ enabled, tier2AiHook? }) is
  // validated by broadcast-personalization.service.ts and
  // persisted on the row's `personalization` column, while the
  // MX8 per-recipient config ({ uniqueCoupon, recommendations,
  // segmentBlocks }) is validated by messaging/personalization.ts
  // and persisted as `personalizationConfig`. Shape-only here.
  @IsOptional() personalization?: unknown;
  // MS8: recurrence ({ freq, interval, weekdays?, endsAt? }) —
  // shape-only typing here; the VALUES are validated strictly by
  // messaging/recurrence.ts in the service (400 on bad shape).
  @IsOptional() recurrence?: unknown;
  // MX2: fallback cascade config — shape-only typing here; the
  // VALUES are validated strictly by messaging/cascade.ts in
  // the service (400 on an unknown channel, a missing primary
  // channel, or fewer than two channels).
  @IsOptional() cascade?: unknown;
  // MX12: push click-through URL — shape-only typing here;
  // the shop-relative rule is validated strictly in the
  // service (validatePushUrl), like the cascade precedent.
  @IsOptional() @IsString() pushUrl?: string;
  // MX13: telegram inline URL buttons — shape-only typing
  // here; the {label, url} rules (≤ 4 buttons, https URLs)
  // are validated strictly in the service
  // (validateTelegramButtons), like the cascade precedent.
  @IsOptional() telegramButtons?: unknown;
  // MX14: onsite click-through URL — shape-only typing here;
  // the shop-relative rule is validated strictly in the
  // service (validateOnsiteUrl), like the cascade precedent.
  @IsOptional() @IsString() onsiteUrl?: string;
  // MX15: per-broadcast estimated-cost cap (minor units).
  @IsOptional() @IsInt() @Min(1) budgetCapMinor?: number;
  // MX16: per-pair A/B auto-winner override (absent = inherit
  // the org switch, which defaults OFF).
  @IsOptional() @IsBoolean() abAutoWinnerEnabled?: boolean;
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

/** MX4: create a messaging journey. steps/conditions are
 * shape-only typing here — the VALUES are validated strictly
 * in the service (allowlist + engine-mirrored rules), and the
 * workflow engine re-validates on create. */
export class CreateJourneyDto {
  @IsString() name!: string;
  @IsString() trigger!: string;
  @IsOptional() conditions?: unknown;
  @IsArray() steps!: any[];
  @IsOptional() @IsBoolean() exitOnPurchase?: boolean;
}

/** MX4: update a messaging journey (all fields optional;
 * in-flight runs keep their frozen stepsSnapshot). */
export class UpdateJourneyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() trigger?: string;
  @IsOptional() conditions?: unknown;
  @IsOptional() @IsArray() steps?: any[];
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() exitOnPurchase?: boolean;
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

/** MX11: natural-language segment draft. The response is a
 * DRAFT definition only — nothing is created by this endpoint;
 * a human saves it through the saved-audience path. */
export class AiSegmentDraftDto {
  @IsString() description!: string;
  @IsOptional() @IsString() entity?: string;
}

/** MX16: AI campaign planner. The response is a PROPOSAL only —
 * the DTO has no save/send target by design; nothing is created
 * by this endpoint. */
export class AiPlannerDto {
  @IsString() goal!: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() audienceHint?: string;
}

/** MX16: Bangla↔English translation draft — returned only,
 * never saved to a template or broadcast by this endpoint. */
export class AiTranslateDto {
  @IsOptional() @IsString() subject?: string;
  @IsString() body!: string;
  @IsString() targetLanguage!: string;
}

/** MX16: subject-line quality score — a deterministic HEURISTIC
 * (labelled as such in the response), not an AI call. */
export class AiSubjectScoreDto {
  @IsString() subject!: string;
}

/** MX16: per-pair A/B auto-winner toggle. `enabled` may be
 * true, false, or explicit null (= inherit the org switch) —
 * shape-only here; the service validates the tri-state. */
export class AbAutoWinnerDto {
  @IsOptional() enabled?: boolean | null;
}

/** MX11: human-confirmed suppression of unengaged contacts.
 * `items` is shape-only here — the service validates each
 * (type, id) against the org's real contacts. */
export class ApplySuppressionDto {
  @IsString() channel!: string;
  @IsArray() items!: { type: string; id: string }[];
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
  // MX12: push click-through URL (push broadcasts only; the
  // service re-validates the shop-relative rule; null clears).
  @IsOptional() @IsString() pushUrl?: string | null;
  // MX13: telegram inline URL buttons (telegram broadcasts
  // only; the service re-validates; null clears).
  @IsOptional() telegramButtons?: unknown;
  // MX14: onsite click-through URL (onsite broadcasts only;
  // the service re-validates the shop-relative rule; null clears).
  @IsOptional() @IsString() onsiteUrl?: string | null;
  // SA-B20 (G2): personalisation config; null turns it off.
  // Shape-only typing; values validated by the service.
  @IsOptional() personalization?: unknown;
}

/** MS2: per-org messaging consent settings. The service re-validates
 * strictly (cap integer 0..20); these decorators are the first gate. */
export class UpdateMessagingSettingDto {
  @IsOptional() @IsInt() @Min(0) @Max(20) frequencyCapPerDay?: number;
  @IsOptional() @IsBoolean() whatsappOptInRequired?: boolean;
  // MS5: broadcast link tracking (UTM + signed redirect wrap).
  @IsOptional() @IsBoolean() linkTrackingEnabled?: boolean;
  // MX3: marketing sweep caps — null clears back to the platform
  // default; the service re-validates the ranges strictly.
  @IsOptional() @IsInt() @Min(1) @Max(50) marketingMaxBroadcastsPerSweep?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(5000) marketingMaxEntriesPerSweep?: number | null;
  // MX3: marketing quiet hours (org timezone). Bounds are strict
  // "HH:mm" strings or null; the service validates the format.
  // MX9: WhatsApp template quality guard (real synced RED /
  // REJECTED templates refused for new broadcast sends).
  @IsOptional() @IsBoolean() whatsappQualityGuardEnabled?: boolean;
  // MX11: rule-based predictive-segment thresholds (the service
  // re-validates the ranges strictly).
  @IsOptional() @IsInt() @Min(1) @Max(3650) churnRiskSilentDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) likelyToBuyMinScore?: number;
  @IsOptional() @IsInt() @Min(0) highLtvMinSpentMinor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) unengagedSuppressDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) unengagedMinSends?: number;
  // MX15: governance — approval switch + spend caps (minor
  // units; null clears a cap; the service re-validates strictly).
  @IsOptional() @IsBoolean() approvalEnabled?: boolean;
  // MX16: A/B auto-winner org switch (default OFF).
  @IsOptional() @IsBoolean() abAutoWinnerEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) broadcastCostCapMinor?: number | null;
  @IsOptional() @IsInt() @Min(1) monthlySpendCapMinor?: number | null;
  @IsOptional() @IsBoolean() quietHoursEnabled?: boolean;
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "quietHoursStart must be a HH:mm time" }) quietHoursStart?: string | null;
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "quietHoursEnd must be a HH:mm time" }) quietHoursEnd?: string | null;
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

/** MX15: pre-send checklist v2 — extends the MS5 check with
 * honestly-runnable checks over a real recipient sample. The
 * audience fields mirror the preview DTO; all optional (no
 * audience = the variable check reports itself not-run). */
export class ComposeCheckV2Dto {
  @IsString() channel!: string;
  @IsOptional() @IsString() subject?: string;
  @IsString() body!: string;
  @IsOptional() @IsString() htmlBody?: string;
  @IsOptional() @IsString() audienceType?: string;
  @IsOptional() @IsString() audienceStage?: string;
  @IsOptional() @IsString() audienceSegment?: string;
  @IsOptional() audienceDefinition?: unknown;
  @IsOptional() @IsString() audienceSavedId?: string;
  @IsOptional() audienceCsv?: unknown;
  @IsOptional() @IsString() topic?: string;
}

/** MX15: approval decision (approve/reject) — note optional. */
export class ApprovalDecisionDto {
  @IsOptional() @IsString() note?: string;
}

/** MX15: seed/test recipient create. */
export class CreateSeedRecipientDto {
  @IsString() channel!: string;
  @IsString() address!: string;
  @IsOptional() @IsString() label?: string;
}

/** MX15: one-click test send to a seed recipient. */
export class TestSendSeedDto {
  @IsString() seedId!: string;
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
  // MX9: preview-only — the selected WhatsApp template whose
  // stored Meta category selects the per-category rate.
  @IsOptional() @IsString() whatsappTemplateId?: string;
  // MX11: preview-only — the form's holdout percentage; the
  // preview reports the held-out count from the same hash bucket.
  @IsOptional() @IsInt() @Min(1) @Max(50) holdoutPercent?: number;
}

/** SA-B20 (G2): personalisation preview — the composer's current
 *  form state (channel/body/audience + the personalisation
 *  config) rendered for a few sample recipients through the
 *  exact functions a send will use. `body` is inherited from
 *  PreviewBroadcastDto; the service refuses a missing body. */
export class PreviewPersonalisationDto extends PreviewBroadcastDto {
  @IsOptional() @IsString() subject?: string;
  // Shape-only typing; validated strictly by the service.
  @IsOptional() personalization?: unknown;
  @IsOptional() @IsInt() sampleSize?: number;
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
  // MX9: optional org-entered per-category WhatsApp rates.
  @IsOptional() @IsInt() @Min(0) whatsappMarketingCostPerMessageMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) whatsappUtilityCostPerMessageMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) whatsappAuthenticationCostPerMessageMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) emailCostPerMessageMinor?: number | null;
}
/** MX2: an ADDITIONAL tenant SMS gateway (failover set). The
 * service validates the gateway id + priority strictly. */
export class AddSmsGatewayDto {
  @IsString() smsGateway!: string;
  @IsString() smsApiKey!: string;
  @IsString() smsSenderId!: string;
  @IsOptional() @IsString() smsApiUrl?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
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

/** MX6: keyword-campaign rule. applyTagTo / pollOptions are
 * shape-only typing here — the VALUES are validated strictly in
 * the service (reserved keywords, duplicate claims, poll shape,
 * action requirements), like the cascade/recurrence precedents. */
export class CreateKeywordRuleDto {
  @IsString() name!: string;
  @IsString() kind!: string;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() applyTagTo?: unknown;
  @IsOptional() @IsString() autoReplyText?: string;
  @IsOptional() pollOptions?: unknown;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
export class UpdateKeywordRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() applyTagTo?: unknown;
  @IsOptional() @IsString() autoReplyText?: string;
  @IsOptional() pollOptions?: unknown;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
/** MX6: a human decision on one hit's AI classification
 * suggestion ("confirm" | "dismiss" — validated in the service). */
export class ApplyKeywordLabelDto {
  @IsString() decision!: string;
}

/** MX10: opt-in (growth) form. `channels`/`popup` are shape-only
 * here — validated strictly in the service. */
export class CreateOptInFormDto {
  @IsString() name!: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() description?: string;
  channels!: unknown;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsBoolean() doubleOptIn?: boolean;
  @IsOptional() @IsString() successMessage?: string;
  @IsOptional() popup?: unknown;
  @IsOptional() @IsString() keyword?: string;
}
export class UpdateOptInFormDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() channels?: unknown;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsBoolean() doubleOptIn?: boolean;
  @IsOptional() @IsString() successMessage?: string;
  @IsOptional() popup?: unknown;
  @IsOptional() @IsString() keyword?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
/** MX10: public signup submit (token-free public form endpoint;
 * the form slug + org id in the URL are the address, and the
 * writes are preference rows only after validation). */
export class SubmitOptInFormDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}
/** MX10: preference-center update from the public token page. */
export class UpdatePreferenceCenterDto {
  @IsOptional() channels?: Record<string, boolean>;
  @IsOptional() topics?: string[] | null;
  @IsOptional() maxPerDay?: number | null;
}
export class IssuePreferenceLinkDto {
  @IsString() channel!: string;
  @IsString() address!: string;
}
/** MX10: CSV import wizard — preview carries raw CSV text + the
 * column mapping chosen in the mapping step. */
export class PreviewCsvImportDto {
  @IsString() channel!: string;
  @IsString() csv!: string;
  mapping!: { name?: string; email?: string; phone?: string };
}
