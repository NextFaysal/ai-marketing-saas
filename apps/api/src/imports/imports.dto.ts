import { IsOptional, IsString, MaxLength } from "class-validator";
export class ImportProductsCsvDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsString() @MaxLength(2_000_000) csvText!: string;
}
