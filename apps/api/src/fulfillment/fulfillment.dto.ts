import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { FULFILLMENT_STATUSES } from "./fulfillment.service";
import { RETURN_RESOLUTIONS } from "./returns.service";

export class FulfillmentItemDto {
  @IsString() orderItemId!: string;
  @IsInt() @Min(1) @Max(9999) quantity!: number;
}

export class CreateFulfillmentDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FulfillmentItemDto)
  items?: FulfillmentItemDto[];
  @IsOptional() @IsString() @MaxLength(80) courierShipmentId?: string;
}

export class PackedItemDto {
  @IsString() orderItemId!: string;
  @IsBoolean() packed!: boolean;
}

export class UpdateFulfillmentDto {
  @IsOptional() @IsIn(FULFILLMENT_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PackedItemDto)
  packed?: PackedItemDto[];
  @IsOptional() @IsString() @MaxLength(120) trackingCode?: string;
  @IsOptional() @IsString() @MaxLength(60) courierProvider?: string;
}

// ---- ON6: Fulfillment Excellence ----

export class UpdateFulfillmentSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(720) confirmToPackHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) packToHandoverHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) stuckDays?: number;
}

export class CreatePickWaveDto {
  @IsArray() @IsString({ each: true }) orderIds!: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RecordDeliveryAttemptDto {
  @IsOptional() @IsString() @MaxLength(80) shipmentId?: string;
  @IsString() outcome!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(10) rescheduleDate?: string;
}

export class SubmitReturnItemDto {
  @IsString() orderItemId!: string;
  @IsInt() @Min(1) @Max(9999) quantity!: number;
}

export class SubmitReturnDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SubmitReturnItemDto)
  items!: SubmitReturnItemDto[];
}

export class DecideReturnDto {
  @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsIn(RETURN_RESOLUTIONS as unknown as string[]) resolution?: string;
  @IsOptional() @IsString() @MaxLength(30) refundAmountMinor?: string;
}

export class BookReturnCourierDto {
  @IsOptional() @IsString() @MaxLength(40) provider?: string;
  @IsOptional() @IsString() @MaxLength(500) recipientAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(40) recipientPhone?: string;
}

export class ReceivedItemDto {
  @IsString() orderItemId!: string;
  @IsOptional() @IsString() @MaxLength(200) condition?: string;
  @IsOptional() @IsBoolean() restock?: boolean;
}

export class MarkReceivedDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceivedItemDto)
  items!: ReceivedItemDto[];
}
