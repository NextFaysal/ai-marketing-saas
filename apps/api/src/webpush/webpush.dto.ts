import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

/** AB7 (AX16): staff push-setting update. promptDelaySec is the
 * delay before the shop shows the browser permission prompt. */
export class UpdatePushSettingDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(300) promptDelaySec?: number;
}

/** The browser PushSubscription's own encryption keys. */
export class PushSubscriptionKeysDto {
  @IsString() @MaxLength(512) p256dh!: string;
  @IsString() @MaxLength(512) auth!: string;
}

/** Public subscribe + staff test-device registration share the
 * subscription shape (the test-device route adds no fields —
 * the route itself is what marks the row a test device). */
export class PushSubscribeDto {
  @IsString() @MaxLength(1000) endpoint!: string;
  @ValidateNested() @Type(() => PushSubscriptionKeysDto) keys!: PushSubscriptionKeysDto;
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
}

export class PushUnsubscribeDto {
  @IsString() @MaxLength(1000) endpoint!: string;
}

/** One push send (test-send + campaign create share the shape).
 * `url` is validated in the service: shop-relative paths only. */
export class PushSendDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(300) body!: string;
  @IsOptional() @IsString() @MaxLength(500) url?: string;
}

export class CreatePushCampaignDto extends PushSendDto {}
