import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

/** NF10 — accounting DTOs. Money stays string minor units at the
 * boundary (the codebase convention); the service converts with
 * toBig and never trusts a float. */

export class CreateAccountDto {
  @IsString() @MaxLength(10) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(20) type!: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(20) type?: string;
}

export class JournalLineDto {
  @IsString() accountId!: string;
  @IsOptional() @IsString() @MaxLength(30) debitMinor?: string;
  @IsOptional() @IsString() @MaxLength(30) creditMinor?: string;
}

export class CreateManualEntryDto {
  @IsString() @MaxLength(10) date!: string;
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class StatementMappingDto {
  @IsString() @MaxLength(200) dateColumn!: string;
  @IsString() @MaxLength(200) amountColumn!: string;
  @IsOptional() @IsString() @MaxLength(200) descriptionColumn?: string;
  @IsOptional() @IsString() @MaxLength(200) directionColumn?: string;
}

export class ImportStatementDto {
  @IsString() @MaxLength(2_000_000) csvText!: string;
  @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @IsOptional() @IsString() @MaxLength(200) accountLabel?: string;
  @IsOptional() @IsBoolean() force?: boolean;
  @IsObject() @ValidateNested() @Type(() => StatementMappingDto)
  mapping!: StatementMappingDto;
}

export class ResolveStatementLineDto {
  /** "confirm" | "reject" — validated in the service. */
  @IsString() @MaxLength(20) action!: string;
  @IsOptional() @IsString() @MaxLength(50) refType?: string;
  @IsOptional() @IsString() @MaxLength(100) refId?: string;
}
