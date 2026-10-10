import { Type } from "class-transformer";
import { IsArray, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class SessionDataDto {
  @IsOptional() @IsString() utmSource?: string;
  @IsOptional() @IsString() utmMedium?: string;
  @IsOptional() @IsString() utmCampaign?: string;
  @IsOptional() @IsString() utmContent?: string;
  @IsOptional() @IsString() utmTerm?: string;
  @IsOptional() @IsString() fbclid?: string;
  @IsOptional() @IsString() gclid?: string;
  @IsOptional() @IsString() ttclid?: string;
  @IsOptional() @IsString() @MaxLength(2000) landingPage?: string;
  @IsOptional() @IsString() @MaxLength(2000) referrer?: string;
}

export class TrackEventDto {
  @IsString() @MaxLength(100) clientEventId!: string;
  @IsString() @MaxLength(100) anonymousId!: string;
  @IsString() @MaxLength(100) sessionKey!: string;
  @IsString() @MaxLength(50) type!: string;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsString() @MaxLength(2000) referrer?: string;
  @IsOptional() @IsString() occurredAt?: string; // ISO string from the browser
  @IsOptional() @ValidateNested() @Type(() => SessionDataDto) session?: SessionDataDto;
  @IsOptional() @IsObject() properties?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) orderExternalId?: string;
  @IsOptional() @IsString() value?: string; // decimal string
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
}

export class IngestDto {
  @IsString() key!: string; // store tracking key (public identifier, not a secret)
  @IsArray() @ValidateNested({ each: true }) @Type(() => TrackEventDto) events!: TrackEventDto[];
}
