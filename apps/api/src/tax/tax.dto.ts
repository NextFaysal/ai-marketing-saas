import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** EC23: org tax settings. defaultVatBps is basis points
 * (1500 = 15.00%, 750 = 7.5%); null = tax OFF for the org. */
export class UpdateTaxSettingsDto {
  @IsOptional() @IsString() @MaxLength(200) legalName?: string | null;
  @IsOptional() @IsString() @MaxLength(100) tin?: string | null;
  @IsOptional() @IsString() @MaxLength(100) binVatNo?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000) defaultVatBps?: number | null;
  @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
}
