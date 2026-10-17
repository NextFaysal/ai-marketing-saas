import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** NF12 (FB4) — dropship + supplier-portal DTOs. Money crosses
 * the wire as strings (minor units); the services enforce the
 * numeric rules with Bengali 400s in the codebase's style. */

export class InviteDropshipDto {
  @IsString() @MaxLength(120) slug!: string;
  /** The OTHER org's role in the pair. */
  @IsIn(["supplier", "seller"]) role!: string;
}

export class RespondDropshipDto {
  @IsBoolean() accept!: boolean;
}

export class SetDropshipOfferDto {
  @IsString() productId!: string;
  @IsString() floorPriceMinor!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateDropshipListingDto {
  @IsString() agreementId!: string;
  @IsString() offerId!: string;
  @IsString() priceMinor!: string;
}

export class SetListingActiveDto {
  @IsBoolean() active!: boolean;
}

export class ProcessDropshipOrderDto {
  @IsString() sellerOrderId!: string;
}

export class PortalShipDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PortalLeadTimeDto {
  @IsOptional() leadTimeDays?: number | null;
  @IsOptional() @IsString() @MaxLength(500) leadTimeNote?: string | null;
}
