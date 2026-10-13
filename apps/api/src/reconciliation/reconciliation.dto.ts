import { Type } from "class-transformer";
import {
  IsBoolean, IsObject, IsOptional, IsString, MaxLength, ValidateNested,
} from "class-validator";

/** EC26 — courier COD reconciliation DTOs. The sheet arrives as a
 * JSON body { csvText } (the imports/leads precedent), capped at
 * 2 MB like every other CSV import in this codebase. */

export class ColumnMappingDto {
  /** The sheet's own header name for the tracking/consignment column. */
  @IsString() @MaxLength(200) trackingColumn!: string;
  /** The sheet's own header name for the collected COD amount column. */
  @IsString() @MaxLength(200) amountColumn!: string;
  @IsOptional() @IsString() @MaxLength(200) chargeColumn?: string;
  @IsOptional() @IsString() @MaxLength(200) orderRefColumn?: string;
  @IsOptional() @IsString() @MaxLength(200) statusColumn?: string;
}

export class ReadHeadersDto {
  @IsString() @MaxLength(2_000_000) csvText!: string;
}

export class ImportSheetDto {
  @IsString() courierIntegrationId!: string;
  @IsString() @MaxLength(2_000_000) csvText!: string;
  @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  /** When given, this mapping is saved as the courier's profile
   * as part of the import; when absent the saved profile is used. */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ColumnMappingDto)
  mapping?: ColumnMappingDto;
  /** Re-import the exact same file (same sha256) anyway. Money is
   * still protected: already-collected shipments are never
   * overwritten by an import. */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class SaveProfileDto {
  @IsString() courierIntegrationId!: string;
  @IsObject() @ValidateNested() @Type(() => ColumnMappingDto)
  mapping!: ColumnMappingDto;
}

export class ResolveLineDto {
  /** "accept_sheet" | "mark_reviewed" — validated in the service
   * so an unknown action gets a Bengali 400. */
  @IsString() @MaxLength(50) action!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
