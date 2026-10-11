import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

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

export class CreateSocialPostDto {
  @IsString() socialAccountId!: string;
  @IsString() @MaxLength(5000) caption!: string;
  @IsOptional() @IsString() @MaxLength(2048) linkUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SocialMediaRefDto)
  mediaRefs?: SocialMediaRefDto[];
}

export class UpdateSocialPostDto {
  @IsOptional() @IsString() @MaxLength(5000) caption?: string;
  @IsOptional() @IsString() @MaxLength(2048) linkUrl?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SocialMediaRefDto)
  mediaRefs?: SocialMediaRefDto[];
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

// SP7: the org-level social settings switch (OWNER/ADMIN write).
export class UpdateSocialSettingsDto {
  @IsBoolean() socialRequireApproval!: boolean;
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

export class CreateTemplateImageDto {
  @IsOptional() @IsString() mediaAssetId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsString() @MaxLength(120) headline!: string;
  @IsOptional() @IsString() @MaxLength(160) subtext?: string;
}
