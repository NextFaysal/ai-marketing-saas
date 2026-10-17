import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * NF2 (FB1) — Short Video Studio DTOs. Template/language are
 * also validated in the service (the merchant-readable Bengali
 * 400 lives there); the DTO pins types + lengths at the edge.
 */
export class CreateVideoProjectDto {
  @IsString() @MaxLength(64) productId!: string;
  @IsOptional() @IsIn(["showcase", "offer"]) template?: string;
  @IsOptional() @IsIn(["bn", "en"]) language?: string;
  @IsOptional() @IsString() @MaxLength(200) offerText?: string;
}

export class PublishVideoProjectDto {
  /** Omit to use the org's first connected social account. */
  @IsOptional() @IsString() @MaxLength(64) socialAccountId?: string;
  /** Omit for the default caption (product name + real price). */
  @IsOptional() @IsString() @MaxLength(5000) caption?: string;
}
