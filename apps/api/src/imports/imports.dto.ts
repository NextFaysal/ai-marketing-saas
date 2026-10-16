import { IsOptional, IsString, MaxLength } from "class-validator";
export class ImportProductsCsvDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsString() @MaxLength(2_000_000) csvText!: string;
}

/** GB2 (GC6 §3): Excel product import — the .xlsx file travels as base64. */
export class ImportProductsXlsxDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsString() @MaxLength(2_800_000) fileBase64!: string;
}
