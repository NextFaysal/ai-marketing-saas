import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class StartPackingScanDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}

export class ScanItemVerifyDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  orderItemId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class VisionLabelScanDto {
  @IsString()
  @IsNotEmpty()
  imageBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class CompletePackingScanDto {
  @IsOptional()
  @IsBoolean()
  overrideMismatch?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
