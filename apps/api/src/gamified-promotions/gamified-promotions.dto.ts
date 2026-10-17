/**
 * NF6 (FB3) — gamified-promotion DTOs (plain interfaces, the
 * booking.dto.ts pattern): merchant-readable validation lives
 * in the service / promo-config so failures are Bengali 400s.
 */

export interface PlacementDto {
  trigger?: string;
  delaySeconds?: number;
  scrollPercent?: number;
  frequencyDays?: number;
  showOn?: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface CreatePromoCampaignDto extends PlacementDto {
  kind?: string; // spin_wheel | quiz | group_buy
  name?: string;
  active?: boolean;
  config?: unknown;
}

export interface UpdatePromoCampaignDto extends PlacementDto {
  name?: string;
  active?: boolean;
  config?: unknown;
}

export interface SetPromoActiveDto {
  active?: boolean;
}

export interface PublicPlayDto {
  phone?: string;
  name?: string | null;
  /**
   * A client may send the segment it WISHES it won. It is read
   * by nobody: the outcome is drawn server-side from the
   * segment weights (promo-config pickWheelSegment) and this
   * field exists in the type only to make that refusal
   * explicit and spec-pinned.
   */
  claimedSegmentIndex?: number;
}

export interface PublicQuizCompleteDto {
  phone?: string;
  name?: string | null;
  answers?: number[];
}

export interface PublicGroupBuyJoinDto {
  phone?: string;
  name?: string | null;
}
