import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

// SP1: step 1 of the picker flow — verify a Meta token and list its
// Pages WITHOUT storing anything (no Integration, no credential, no
// audit). The token is used for this call only.
export class MetaSocialDiscoverDto {
  @IsString() @MinLength(10) accessToken!: string;
}

export class MetaSocialConnectDto {
  @IsString() @MinLength(10) accessToken!: string;
  // Validated in the service: missing/empty is a Bengali 400 (never
  // a silent connect-all), mirroring the AD5 picker discipline.
  @IsOptional() @IsArray() @IsString({ each: true }) pageIds?: string[];
  // CC28: which Meta app this token was minted under — "own" =
  // the tenant's own Meta app (TenantAppConfig "meta" must
  // exist), "platform" (default) = the platform's Meta app.
  // Recorded on the Integration + SocialAccount rows; the
  // token-exchange healing (CC21a) resolves by exactly this.
  @IsOptional() @IsIn(["platform", "own"]) appSource?: string;
}

// Base64 JSON upload, same shape as the inbox SendMediaDto. The raw
// byte cap (2.1 MB) is enforced in the service after decoding; the
// string cap here bounds the payload (2.1 MB ≈ 2.8M base64 chars).
export class UploadSocialMediaDto {
  @IsString() @MaxLength(2900000) dataBase64!: string;
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsOptional() @IsString() @MaxLength(120) contentType?: string;
}

export class SocialMediaRefDto {
  @IsString() assetId!: string;
  @IsString() kind!: string; // must match the MediaAsset's sniffed kind (service-checked)
}

// SU8: YouTube metadata + cover + story fields, shared by the
// create and update DTOs (each class declares them separately —
// class-validator decorators do not inherit cleanly through a
// mixin here). youtubeTags: at most 30 tags, each ≤100 chars.
export class CreateSocialPostDto {
  @IsString() socialAccountId!: string;
  @IsString() @MaxLength(5000) caption!: string;
  @IsOptional() @IsString() @MaxLength(2048) linkUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SocialMediaRefDto)
  mediaRefs?: SocialMediaRefDto[];
  // SU1: first comment (posted after a successful publish) +
  // SU2: recurrence (frequency without interval defaults to 1 in
  // the service; interval alone is a 400 there).
  @IsOptional() @IsString() @MaxLength(1000) firstCommentText?: string | null;
  @IsOptional() @IsIn(["daily", "weekly", "monthly"]) recurrenceFrequency?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) recurrenceInterval?: number | null;
  // SU8 fields.
  @IsOptional() @IsString() @MaxLength(100) youtubeTitle?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(100, { each: true }) youtubeTags?: string[] | null;
  @IsOptional() @IsString() @MaxLength(10) youtubeCategoryId?: string | null;
  @IsOptional() @IsBoolean() youtubeIsShort?: boolean;
  // SN1: target YouTube playlist id (from the playlists endpoint).
  @IsOptional() @IsString() @MaxLength(200) youtubePlaylistId?: string | null;
  @IsOptional() @IsString() coverAssetId?: string | null;
  @IsOptional() @IsBoolean() isStory?: boolean;
}

export class UpdateSocialPostDto {
  @IsOptional() @IsString() @MaxLength(5000) caption?: string;
  @IsOptional() @IsString() @MaxLength(2048) linkUrl?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SocialMediaRefDto)
  mediaRefs?: SocialMediaRefDto[];
  @IsOptional() @IsString() @MaxLength(1000) firstCommentText?: string | null;
  @IsOptional() @IsIn(["daily", "weekly", "monthly"]) recurrenceFrequency?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) recurrenceInterval?: number | null;
  // SU8 fields (null clears the nullable ones).
  @IsOptional() @IsString() @MaxLength(100) youtubeTitle?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(100, { each: true }) youtubeTags?: string[] | null;
  @IsOptional() @IsString() @MaxLength(10) youtubeCategoryId?: string | null;
  @IsOptional() @IsBoolean() youtubeIsShort?: boolean;
  // SN1: target YouTube playlist id (null clears).
  @IsOptional() @IsString() @MaxLength(200) youtubePlaylistId?: string | null;
  @IsOptional() @IsString() coverAssetId?: string | null;
  @IsOptional() @IsBoolean() isStory?: boolean;
}

// SU8: cross-post derive — one source post, several target
// accounts; incompatible targets are skipped with a warning
// (service), never a hard failure of the whole derive.
export class DeriveSocialPostDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) accountIds!: string[];
}

// SU1: one post group = per-platform variants of the same content.
export class CreateSocialPostGroupDto {
  @IsString() @MaxLength(120) name!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CreateSocialPostDto)
  variants!: CreateSocialPostDto[];
}

// SU2: posting slots.
export class CreateSocialPostingSlotDto {
  @IsString() socialAccountId!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsString() @MaxLength(5) time!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateSocialPostingSlotDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday?: number;
  @IsOptional() @IsString() @MaxLength(5) time?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

// SU2: evergreen recycle config for one post.
export class UpdateEvergreenDto {
  @IsBoolean() isEvergreen!: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) evergreenMinGapDays?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(52) evergreenMaxCycles?: number | null;
}

// SP3: grounded AI caption generation (M55 parity — enforcement,
// grounding and usage accounting live in SocialAiService).
export class GenerateSocialCopyDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() @MaxLength(500) topic?: string;
  @IsOptional() @IsString() @MaxLength(120) tone?: string;
  @IsOptional() @IsIn(["bn", "en"]) language?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) count?: number;
  @IsOptional() @IsIn(["meta_page", "instagram"]) platform?: string;
}

export class CreateHashtagSetDto {
  @IsString() @MaxLength(80) name!: string;
  @IsArray() @IsString({ each: true }) tags!: string[];
}

export class UpdateHashtagSetDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

// SP5: schedule a post. The value is an ISO 8601 timestamp; the
// semantic checks (parseable, not in the past) live in the service
// with Bengali errors, matching the SP1 style where DTO-empty
// checks live in the service.
export class ScheduleSocialPostDto {
  @IsString() scheduledAt!: string;
}

// SP7: reject a post pending approval. The note is REQUIRED — the
// non-empty check lives in the service so its error is the
// Bengali explanation the author will act on.
export class RejectSocialPostDto {
  @IsString() @MaxLength(500) note!: string;
}

// SP9: finish a YouTube connect by choosing one channel from the
// pick state the callback created. Both fields are validated
// against the state row in the service (the state is the
// authority on which channels this authorization granted).
export class SelectYouTubeChannelDto {
  @IsString() @MaxLength(200) state!: string;
  @IsString() @MaxLength(200) channelId!: string;
}

// CC20: finish a LinkedIn connect by choosing one Page from the
// pick state the callback created (same authority rule as SP9).
export class SelectLinkedInOrganizationDto {
  @IsString() @MaxLength(200) state!: string;
  @IsString() @MaxLength(200) organizationId!: string;
}

// SP7: the org-level social settings switch (OWNER/ADMIN write).
// SU9: both fields optional — a PATCH touches only what it
// carries (the service preserves the absent field).
export class UpdateSocialSettingsDto {
  @IsOptional() @IsBoolean() socialRequireApproval?: boolean;
  @IsOptional() @IsBoolean() socialApprovalTwoStep?: boolean;
}

// SU9: an internal team note on a post (never sent to any
// platform). The non-empty check lives in the service so its
// error is the Bengali explanation.
export class CreateSocialPostNoteDto {
  @IsString() @MaxLength(5000) body!: string;
}

// SU9: assign a post to a team member; null unassigns.
// @IsOptional skips the other validators for null/undefined.
export class AssignSocialPostDto {
  @IsOptional() @IsString() @MaxLength(200) assignedUserId?: string | null;
}

// SU5: commerce auto-draft settings (OWNER/ADMIN write). Every
// field optional — a PATCH touches only what it carries. The
// 1–20 cap range and the connected-account check are ALSO
// enforced in SocialCommerceDraftService (direct callers).
export class UpdateAutoDraftSettingsDto {
  @IsOptional() @IsBoolean() newProductEnabled?: boolean;
  @IsOptional() @IsBoolean() saleEnabled?: boolean;
  @IsOptional() @IsBoolean() backInStockEnabled?: boolean;
  @IsOptional() @IsBoolean() reviewMilestoneEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) maxDraftsPerDay?: number;
  @IsOptional() @IsString() @MaxLength(200) socialAccountId?: string | null;
}

// SP4: AI image generation + template poster composition.
export class GenerateAiImageDto {
  @IsString() @MaxLength(1000) prompt!: string;
  @IsOptional() @IsString() productId?: string;
}

// PP3: import one product's image (its external imageUrl) into
// the Media Library. The fetch discipline (https-only, SSRF guard,
// magic-byte sniff, size cap, dedupe) lives in SocialImportService.
export class ImportSocialMediaDto {
  @IsString() productId!: string;
}

// SU3: media library folders + asset organization.
export class CreateMediaFolderDto {
  @IsString() @MaxLength(120) name!: string;
}

export class UpdateMediaFolderDto {
  @IsString() @MaxLength(120) name!: string;
}

export class UpdateMediaAssetDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  // null is a real value here (move the asset OUT of its folder);
  // @IsOptional skips the other validators for null/undefined.
  @IsOptional() @IsString() folderId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

export class BulkMediaDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
  @IsIn(["move", "delete"]) action!: string;
  @IsOptional() @IsString() folderId?: string | null;
}

// SU3: aspect-ratio edit (derived asset; the source is untouched).
export class EditMediaAssetDto {
  @IsIn(["1:1", "4:5", "9:16", "16:9"]) aspect!: string;
}

// SU3: video cover frame extraction.
export class CoverMediaDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) atSeconds?: number;
}

// SU4: monthly AI content plan.
export class GenerateContentPlanDto {
  @IsString() @MaxLength(7) @Matches(/^\d{4}-\d{2}$/) month!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) pillars?: string[];
  @IsOptional() @IsString() @MaxLength(500) focus?: string;
}

export class MaterializeContentPlanDto {
  @IsArray() @ArrayMaxSize(50) @Type(() => Number) @IsInt({ each: true }) itemIndexes!: number[];
  @IsString() socialAccountId!: string;
}

// SU4: Reel/Short script draft (returned only — nothing is saved).
export class GenerateSocialScriptDto {
  @IsOptional() @IsString() productId?: string;
  @IsString() @MaxLength(500) topic!: string;
  @IsOptional() @IsIn(["bn", "en"]) language?: string;
}

// SU11: bulk post actions. Deliberately loose — the semantic
// checks (ids empty / over the cap, reschedule without a time,
// unknown action) live in SocialService.bulkPosts so their
// errors are the Bengali explanations, mirroring the
// MetaSocialConnectDto discipline.
export class BulkSocialPostsDto {
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() scheduledAt?: string;
}

export class CreateTemplateImageDto {
  @IsOptional() @IsString() mediaAssetId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsString() @MaxLength(120) headline!: string;
  @IsOptional() @IsString() @MaxLength(160) subtext?: string;
}
