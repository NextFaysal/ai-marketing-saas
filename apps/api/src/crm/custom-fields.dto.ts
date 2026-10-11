import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateCustomFieldDto {
  @IsString() entity!: string; // lead | customer (validated in the service)
  @IsOptional() @IsString() @MaxLength(60) key?: string;
  @IsString() @MaxLength(120) label!: string;
  @IsString() type!: string; // text | number | date | select (validated in the service)
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateCustomFieldDto {
  @IsOptional() @IsString() key?: string; // must equal the stored key — the service rejects changes
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
}
