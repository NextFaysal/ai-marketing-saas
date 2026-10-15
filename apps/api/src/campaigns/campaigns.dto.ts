import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

// Campaign Builder Next CN1: a targeting entry is either a
// legacy free-text name (stored as a plain string, flagged
// unverified in readiness) or an object carrying the Meta
// id returned by targeting search — id-carrying entries are
// validated against Meta at save time (see CampaignsService).
export type TargetingEntryInput = string | { id?: string; name: string };
export interface CityInput { key: string; name?: string; radius?: number; distanceUnit?: string }

export class CreatePlanDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() objective!: string;
  @IsString() adAccountId!: string;
  // Campaign Builder Next CN2: true campaign budget —
  // budgetMode "abo" (ad-set budgets, default) or "cbo"
  // (campaign budgets below; taka strings).
  @IsOptional() @IsString() budgetMode?: string;
  @IsOptional() @IsString() campaignDailyBudget?: string;
  @IsOptional() @IsString() campaignLifetimeBudget?: string;
}
export class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() objective?: string;
  // CB2: plan daily budget cap as a taka string ("" clears).
  @IsOptional() @IsString() dailyBudgetCap?: string | null;
  // CN2: budget mode + campaign budgets ("" clears).
  @IsOptional() @IsString() budgetMode?: string;
  @IsOptional() @IsString() campaignDailyBudget?: string | null;
  @IsOptional() @IsString() campaignLifetimeBudget?: string | null;
}
export class AddAdSetDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() dailyBudget?: string;
  @IsOptional() @IsString() lifetimeBudget?: string;
  @IsString() optimizationGoal!: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsArray() countries!: string[];
  @IsOptional() @IsNumber() ageMin?: number;
  @IsOptional() @IsNumber() ageMax?: number;
  @IsOptional() @IsArray() genders?: number[];
  @IsOptional() @IsArray() interests?: TargetingEntryInput[];
  @IsOptional() @IsArray() customAudienceIds?: string[];
  @IsOptional() @IsArray() excludedAudienceIds?: string[];
  // Campaign Builder CB1: placements (vocabulary is
  // validated in the service).
  @IsOptional() @IsArray() platforms?: string[];
  @IsOptional() @IsArray() positions?: string[];
  @IsOptional() @IsArray() devices?: string[];
  // Campaign Builder Next CN1: location depth, locales,
  // behaviors/demographics, one narrowing layer and the
  // detailed-targeting expansion toggle. Shapes are
  // validated in the service (vocabularies live there).
  @IsOptional() @IsArray() cities?: CityInput[];
  @IsOptional() @IsArray() postcodes?: string[];
  @IsOptional() @IsArray() locationTypes?: string[];
  @IsOptional() @IsArray() locales?: number[];
  @IsOptional() @IsArray() behaviors?: TargetingEntryInput[];
  @IsOptional() @IsObject() demographics?: Record<string, unknown>;
  @IsOptional() @IsArray() narrowInterests?: TargetingEntryInput[];
  @IsOptional() @IsArray() narrowBehaviors?: TargetingEntryInput[];
  @IsOptional() @IsBoolean() targetingExpansion?: boolean;
  // Campaign Builder Next CN2: bidding. bidAmount /
  // costPerResultGoal are taka strings; roasGoal is a
  // decimal string like "2.0". The strategy/goal support
  // matrix is enforced in the service.
  @IsOptional() @IsString() bidStrategy?: string;
  @IsOptional() @IsString() bidAmount?: string;
  @IsOptional() @IsString() costPerResultGoal?: string;
  @IsOptional() @IsString() roasGoal?: string;
  // Campaign Builder Next CN3/CN4 (NB2): the conversion
  // event (Meta custom_event_type), the catalog pair and
  // the lead form ref. Matrices/refs are enforced in the
  // service; "" clears on PATCH.
  @IsOptional() @IsString() conversionEvent?: string;
  @IsOptional() @IsString() catalogRecordId?: string;
  @IsOptional() @IsString() productSetId?: string;
  @IsOptional() @IsString() leadFormId?: string;
  // Frontier CN13 (NB6): the WhatsApp destination. The
  // number is NEVER sent by the client — only the id of
  // one of the org's CONNECTED WhatsApp Integrations;
  // the service resolves + verifies it (and reads the
  // digits back from Meta).
  @IsOptional() @IsString() destinationType?: string;
  @IsOptional() @IsString() whatsappIntegrationId?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
}
export class UpdateAdSetDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() dailyBudget?: string;
  @IsOptional() @IsString() lifetimeBudget?: string;
  @IsOptional() @IsString() optimizationGoal?: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsOptional() @IsArray() countries?: string[];
  @IsOptional() @IsNumber() ageMin?: number;
  @IsOptional() @IsNumber() ageMax?: number;
  @IsOptional() @IsArray() genders?: number[];
  @IsOptional() @IsArray() interests?: TargetingEntryInput[];
  @IsOptional() @IsArray() customAudienceIds?: string[];
  @IsOptional() @IsArray() excludedAudienceIds?: string[];
  @IsOptional() @IsArray() platforms?: string[];
  @IsOptional() @IsArray() positions?: string[];
  @IsOptional() @IsArray() devices?: string[];
  // CN1 (see AddAdSetDto).
  @IsOptional() @IsArray() cities?: CityInput[];
  @IsOptional() @IsArray() postcodes?: string[];
  @IsOptional() @IsArray() locationTypes?: string[];
  @IsOptional() @IsArray() locales?: number[];
  @IsOptional() @IsArray() behaviors?: TargetingEntryInput[];
  @IsOptional() @IsObject() demographics?: Record<string, unknown>;
  @IsOptional() @IsArray() narrowInterests?: TargetingEntryInput[];
  @IsOptional() @IsArray() narrowBehaviors?: TargetingEntryInput[];
  @IsOptional() @IsBoolean() targetingExpansion?: boolean;
  // Campaign Builder Next CN2: bidding. bidAmount /
  // costPerResultGoal are taka strings; roasGoal is a
  // decimal string like "2.0". The strategy/goal support
  // matrix is enforced in the service.
  @IsOptional() @IsString() bidStrategy?: string;
  @IsOptional() @IsString() bidAmount?: string;
  @IsOptional() @IsString() costPerResultGoal?: string;
  @IsOptional() @IsString() roasGoal?: string;
  // CN3/CN4 (see AddAdSetDto).
  @IsOptional() @IsString() conversionEvent?: string;
  @IsOptional() @IsString() catalogRecordId?: string;
  @IsOptional() @IsString() productSetId?: string;
  @IsOptional() @IsString() leadFormId?: string;
  // CN13 (see AddAdSetDto). "" clears the destination.
  @IsOptional() @IsString() destinationType?: string;
  @IsOptional() @IsString() whatsappIntegrationId?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
}
// Campaign Builder Next CN4 (NB2): a Lead Ads Instant Form,
// modelled locally; created on Meta only through the
// create-on-meta action or publish. questions/fieldMapping
// shapes are validated in the service.
export class CreateLeadFormDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() pageId!: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() @MaxLength(200) introHeadline?: string;
  @IsOptional() @IsString() @MaxLength(1000) introDescription?: string;
  @IsArray() questions!: unknown[];
  @IsString() privacyPolicyUrl!: string;
  @IsOptional() @IsString() @MaxLength(70) privacyLinkText?: string;
  @IsOptional() @IsString() @MaxLength(200) thankYouTitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) thankYouBody?: string;
  @IsOptional() @IsString() @MaxLength(100) thankYouButtonText?: string;
  @IsOptional() @IsString() followUpActionUrl?: string;
  @IsOptional() @IsBoolean() higherIntent?: boolean;
  @IsOptional() @IsObject() fieldMapping?: Record<string, string> | null;
}
export class UpdateLeadFormDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() @MaxLength(200) introHeadline?: string;
  @IsOptional() @IsString() @MaxLength(1000) introDescription?: string;
  @IsOptional() @IsArray() questions?: unknown[];
  @IsOptional() @IsString() privacyPolicyUrl?: string;
  @IsOptional() @IsString() @MaxLength(70) privacyLinkText?: string;
  @IsOptional() @IsString() @MaxLength(200) thankYouTitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) thankYouBody?: string;
  @IsOptional() @IsString() @MaxLength(100) thankYouButtonText?: string;
  @IsOptional() @IsString() followUpActionUrl?: string;
  @IsOptional() @IsBoolean() higherIntent?: boolean;
  @IsOptional() @IsObject() fieldMapping?: Record<string, string> | null;
}
export class CreateLeadFormOnMetaDto {
  @IsString() adAccountId!: string;
}
export class RetargetingPresetDto {
  @IsString() kind!: string;
  @IsOptional() @IsString() audienceRecordId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() dailyBudget?: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsOptional() @IsString() catalogRecordId?: string;
  @IsOptional() @IsString() productSetId?: string;
}
export class UpdateAdDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) primaryText?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() linkUrl?: string;
  @IsOptional() @IsString() callToAction?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsString() imageAssetId?: string;
  @IsOptional() @IsString() videoAssetId?: string;
  @IsOptional() @IsArray() carouselCards?: CarouselCardDto[];
  // Campaign Builder Next CN5: creative v2. Shapes are
  // validated + normalized in the service (option caps,
  // placement groups, enhancement feature vocabulary).
  // null clears on PATCH.
  @IsOptional() @IsObject() textOptions?: { primaryTexts?: string[]; headlines?: string[]; descriptions?: string[] } | null;
  @IsOptional() @IsObject() placementAssets?: Record<string, { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }> | null;
  @IsOptional() @IsObject() creativeEnhancements?: Record<string, boolean> | null;
  // Frontier CN13 (NB6): the CTWA welcome experience
  // (Meta page_welcome_message). Shape normalized in the
  // service; null clears on PATCH.
  @IsOptional() @IsObject() whatsappWelcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null;
}
export class CarouselCardDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() linkUrl!: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() imageAssetId?: string;
}
export class AddAdDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(5000) primaryText!: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() description?: string;
  @IsString() linkUrl!: string;
  @IsOptional() @IsString() callToAction?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsString() imageAssetId?: string;
  @IsOptional() @IsString() videoAssetId?: string;
  @IsOptional() @IsArray() carouselCards?: CarouselCardDto[];
  // CN5 creative v2 (see UpdateAdDto).
  @IsOptional() @IsObject() textOptions?: { primaryTexts?: string[]; headlines?: string[]; descriptions?: string[] };
  @IsOptional() @IsObject() placementAssets?: Record<string, { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }>;
  @IsOptional() @IsObject() creativeEnhancements?: Record<string, boolean>;
  // CN13 CTWA welcome (see UpdateAdDto).
  @IsOptional() @IsObject() whatsappWelcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] };
}
// Campaign Builder Next CN5: duplicate an ad as a variant
// carrying a chosen asset — a Creative Library asset
// (creativeAssetId) or a Social/Studio MediaAsset
// (mediaAssetId, images only — see the service for why).
export class CreateVariantDto {
  @IsOptional() @IsString() creativeAssetId?: string;
  @IsOptional() @IsString() mediaAssetId?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
}
// Campaign Builder Next CN6: Audience Studio actions from
// inside an ad set (all ride the existing AudiencesService).
export class StudioCreateAudienceDto {
  @IsString() source!: string;
  @IsOptional() @IsString() segment?: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsBoolean() attach?: boolean;
}
export class StudioLookalikeDto {
  @IsString() sourceAudienceRecordId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() country!: string;
  @IsOptional() @IsNumber() ratio?: number;
  @IsOptional() @IsBoolean() attach?: boolean;
}
export class StudioExclusionPresetDto {
  @IsString() preset!: string;
}
export class InstantiateBlueprintDto {
  @IsString() blueprintKey!: string;
  @IsString() adAccountId!: string;
  @IsOptional() @IsString() productId?: string;
}
export class RejectDto { @IsString() @MaxLength(500) reason!: string; }
export class CommentDto { @IsString() @MaxLength(2000) body!: string; }
export class ScheduleLaunchDto { @IsOptional() @IsString() publishAt?: string | null; }
export class CrossPlatformDto {
  @IsString() platform!: string;
  @IsString() targetAdAccountId!: string;
  // Frontier NB8 / CN17: google draft type ("search" |
  // "pmax") and the TikTok draft-path objective choice
  // with its pixel inputs (plan/draft path only).
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() objectiveType?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsOptional() @IsString() optimizationEvent?: string;
}
export class SuggestPlanDto {
  @IsString() adAccountId!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() @MaxLength(300) goal?: string;
  @IsString() totalDailyBudget!: string;
}
export class GenerateCopyDto {
  @IsString() adSetId!: string;
  @IsString() productId!: string;
  @IsOptional() @IsString() linkUrl?: string;
}
// Campaign Builder Next NB4 (CN7/CN8/CN9).
export class ApplyRecommendationDto {
  @IsString() kind!: string;
  @IsOptional() @IsString() adId?: string;
}
export class GuardrailLinkDto {
  @IsString() ruleId!: string;
}
export class CloneResolutionsDto {
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsOptional() @IsString() catalogRecordId?: string;
  @IsOptional() @IsString() productSetId?: string;
  @IsOptional() @IsString() leadFormId?: string;
  @IsOptional() @IsObject() audienceReplacements?: Record<string, string>;
}
export class ClonePlanToAccountDto {
  @IsString() targetAdAccountId!: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsObject() resolutions?: CloneResolutionsDto;
}
export class UpdateCrossPlatformDraftDto {
  @IsObject() fields!: Record<string, unknown>;
}
// Campaign Builder Next CN11 (NB5): governance.
// Snapshot/restore take no meaningful body — the version
// id in the path is the whole input.
export class SnapshotVersionDto {}
export class RestoreVersionDto {}
export class ApprovalChainDto {
  @IsBoolean() twoStepApproval!: boolean;
}
export class CreateSavedViewDto {
  @IsString() @MaxLength(200) name!: string;
  // Opaque hub filter state — the hub owns its shape;
  // size is capped in the service.
  @IsObject() filters!: Record<string, unknown>;
}

// Campaign Builder Frontier CN15 (NB7): a Meta Experiment
// over two variant plans. The service judges every field
// against the real records (same abGroup, same account,
// both published, pixel + CN3 event present).
export class CreateExperimentDto {
  @IsString() planAId!: string;
  @IsString() planBId!: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsNumber() splitA?: number;
  @IsOptional() @IsString() metricEvent?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsNumber() durationDays?: number;
}
// CN16 (NB7): the full-funnel wizard. Layer configs ride as
// objects — the service validates their contents strictly
// (budgets/countries through the existing addAdSet path).
export class CreateFunnelPlanDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() adAccountId!: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() budgetMode?: string;
  @IsOptional() @IsString() campaignDailyBudget?: string;
  @IsOptional() @IsString() dailyBudgetCap?: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() pixelId?: string;
  @IsOptional() @IsString() conversionEvent?: string;
  @IsOptional() @IsString() optimizationGoal?: string;
  @IsString() primaryText!: string;
  @IsOptional() @IsString() headline?: string;
  @IsString() linkUrl!: string;
  @IsOptional() @IsString() callToAction?: string;
  @IsObject() prospecting!: { dailyBudget: string; countries: string[]; ageMin?: number; ageMax?: number; genders?: number[]; interests?: unknown[]; targetingExpansion?: boolean };
  @IsOptional() @IsObject() retargeting?: { dailyBudget: string } | null;
  @IsOptional() @IsObject() retention?: { dailyBudget: string; catalogRecordId?: string; productSetId?: string } | null;
}
// CN16 (NB7): a recurring series rule. cadence/dates are
// validated strictly by series-dates.ts parseSeriesRule in
// the service (unknown shapes are 400s, never reinterpreted).
export class CreateSeriesDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsString() cadence!: string;
  @IsOptional() @IsNumber() interval?: number;
  @IsOptional() @IsString() anchorDate?: string;
  @IsOptional() @IsArray() dates?: string[];
  @IsOptional() @IsNumber() leadDays?: number;
}
export class SeriesActionDto {
  @IsString() action!: string; // pause | resume | end
}
// Frontier NB8 / CN18: the budget simulator (own-data
// only; the service refuses below its sample floors).
export class BudgetSimulatorDto {
  @IsString() objective!: string;
  @IsString() dailyBudget!: string;
  @IsOptional() @IsNumber() days?: number;
}
// Frontier NB8 / CN18: a competitor-response draft — the
// competitor contributes only an angle note; the copy is
// generated from the org's OWN product (generateCopy).
export class CompetitorResponseDto {
  @IsString() competitorId!: string;
  @IsString() productId!: string;
  @IsString() adAccountId!: string;
}
