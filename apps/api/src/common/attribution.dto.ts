import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * AB7 (AX19) — order-level attribution stamps.
 *
 * The shop client captures UTM parameters + the ad-platform
 * click id from first-party tracking storage and presents them
 * on the native checkout DTOs (shop / express / landing /
 * single-product). At placement the normalized values are
 * stamped ONCE onto the Order row (Order.utmSource …
 * Order.clickId) via IntegrationsService.upsertOrder's CREATE
 * branch.
 *
 * These stamps are the ORDER-LEVEL record of where this order
 * claims to have come from. They are deliberately separate
 * from the attribution ENGINE (apps/api/src/attribution/),
 * which computes visitor-journey / multi-touch attribution —
 * AX19 does not touch the engine, and the engine does not read
 * these columns.
 *
 * Null = untracked: POS, staff manual orders and external-store
 * sync orders never carry an attribution block, so their rows
 * keep every column null.
 */

/** The click-id vocabulary (mirrors TrackingSession/Touchpoint). */
export const CLICK_ID_TYPES = ["fbclid", "gclid", "ttclid"] as const;
export type ClickIdType = (typeof CLICK_ID_TYPES)[number];

/** The plain, DB-ready shape produced by normalizeAttribution. */
export interface NormalizedAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  clickIdType?: ClickIdType;
  clickId?: string;
}

export class AttributionDto {
  @IsOptional() @IsString() @MaxLength(200) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(200) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(200) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(200) utmContent?: string;
  @IsOptional() @IsString() @MaxLength(200) utmTerm?: string;
  @IsOptional() @IsIn(CLICK_ID_TYPES as unknown as string[]) clickIdType?: ClickIdType;
  @IsOptional() @IsString() @MaxLength(500) clickId?: string;
}

const UTM_KEYS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"] as const;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalize a presented attribution block into the exact keys
 * an Order create payload may carry:
 *  - every string is trimmed; empty / whitespace-only values
 *    are DROPPED (the key is absent, so the column stays null);
 *  - a clickIdType outside the fbclid|gclid|ttclid vocabulary
 *    is dropped (the DTO's @IsIn already rejects it at the HTTP
 *    boundary — this is defence-in-depth for direct callers);
 *  - undefined / null input → {} (no keys at all).
 */
export function normalizeAttribution(
  dto: AttributionDto | NormalizedAttribution | null | undefined,
): NormalizedAttribution {
  if (!dto || typeof dto !== "object") return {};
  const out: NormalizedAttribution = {};
  for (const key of UTM_KEYS) {
    const v = clean((dto as any)[key]);
    if (v !== undefined) out[key] = v;
  }
  const type = clean((dto as any).clickIdType);
  if (type !== undefined && (CLICK_ID_TYPES as readonly string[]).includes(type)) {
    out.clickIdType = type as ClickIdType;
  }
  const clickId = clean((dto as any).clickId);
  if (clickId !== undefined) out.clickId = clickId;
  return out;
}

/** True when a normalized block carries at least one stamp. */
export function hasAttribution(normalized: NormalizedAttribution): boolean {
  return Object.keys(normalized).length > 0;
}
