import { IsNumber, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ConnectCourierDto {
  @IsOptional() @IsString() provider?: string; // steadfast | pathao | redx (default steadfast)
  // Steadfast
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() secretKey?: string;
  // Pathao
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
  // RedX (accessToken) + shared baseUrl override (sandbox / legacy)
  @IsOptional() @IsString() accessToken?: string;
  @IsOptional() @IsString() baseUrl?: string;
}

export class BookShipmentDto {
  @IsOptional() @IsString() provider?: string;
  @IsString() orderId!: string;
  @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(30) recipientPhone?: string;
  @IsString() @MinLength(8) @MaxLength(500) recipientAddress!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsObject() pathao?: {
    storeId?: number; cityId?: number; zoneId?: number; areaId?: number;
    deliveryType?: number; itemType?: number; itemWeightKg?: number; itemDescription?: string;
  };
  @IsOptional() @IsObject() redx?: {
    deliveryAreaId?: number; deliveryArea?: string; pickupStoreId?: number; parcelWeightKg?: number;
  };
}
