import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DisbursementItemDto {
  @IsString()
  trackingCode!: string;

  @IsNumber()
  courierCollectedMinor!: number;

  @IsNumber()
  courierFeeMinor!: number;

  @IsOptional()
  @IsNumber()
  netPaidMinor?: number;

  @IsOptional()
  @IsString()
  consignmentId?: string;
}

export class UploadDisbursementDto {
  @IsString()
  provider!: string;

  @IsString()
  referenceNo!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DisbursementItemDto)
  items!: DisbursementItemDto[];
}

export class UpdateDisputeDto {
  @IsString()
  disputeStatus!: string; // NONE | OPEN | CLAIMED | RESOLVED

  @IsOptional()
  @IsString()
  notes?: string;
}
