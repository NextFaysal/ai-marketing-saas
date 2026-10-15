import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

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
  // CC29: the explicit per-order courier ACCOUNT choice (an
  // Integration row id of the chosen provider). Omitted → the
  // EC22 rule's pinned account, else the provider default.
  @IsOptional() @IsString() courierIntegrationId?: string;
  @IsString() orderId!: string;
  @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(30) recipientPhone?: string;
  @IsString() @MinLength(8) @MaxLength(500) recipientAddress!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** ON4: explicit staff override for a review-held order (audited). */
  @IsOptional() @IsBoolean() overrideReviewHold?: boolean;
  @IsOptional() @IsObject() pathao?: {
    storeId?: number; cityId?: number; zoneId?: number; areaId?: number;
    deliveryType?: number; itemType?: number; itemWeightKg?: number; itemDescription?: string;
  };
  @IsOptional() @IsObject() redx?: {
    deliveryAreaId?: number; deliveryArea?: string; pickupStoreId?: number; parcelWeightKg?: number;
  };
}

/** Milestone 53: bulk booking — up to 50 orders through one provider. */
export class BulkBookDto {
  @IsOptional() @IsIn(["steadfast", "pathao", "redx"]) provider?: string;
  // CC29: one explicit courier account for the whole batch.
  @IsOptional() @IsString() courierIntegrationId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) orderIds!: string[];
  @IsOptional() @IsString() recipientName?: string;
  @IsOptional() @IsString() recipientPhone?: string;
  @IsOptional() @IsString() recipientAddress?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() pathao?: { storeId?: number; cityId?: number; zoneId?: number; areaId?: number; deliveryType?: number; itemType?: number; itemWeightKg?: number; itemDescription?: string };
  @IsOptional() @IsObject() redx?: { deliveryAreaId?: number; deliveryArea?: string; pickupStoreId?: number; parcelWeightKg?: number };
}

/** Milestone 52: pre-booking delivery-charge quotation. */
export class QuoteCourierDto {
  @IsOptional() @IsString() provider?: string; // steadfast | pathao | redx
  @IsOptional() @IsString() orderId?: string; // derives the COD collection amount when present
  // The schema carries no product/order weight, so the weight is
  // explicit user input from the booking form (kg like the form,
  // or raw grams); nothing is ever guessed.
  @IsOptional() @IsNumber() weightKg?: number;
  @IsOptional() @IsNumber() weightGrams?: number;
  @IsOptional() @IsObject() pathao?: {
    storeId?: number; cityId?: number; zoneId?: number;
    deliveryType?: number; itemType?: number; itemWeightKg?: number;
  };
  @IsOptional() @IsObject() redx?: {
    deliveryAreaId?: number; pickupAreaId?: number; parcelWeightKg?: number;
  };
}
