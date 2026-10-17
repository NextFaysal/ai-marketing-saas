import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

/**
 * CC3 — save a tenant's OWN app (Meta app / TikTok app). Both
 * fields are required: a partial credential can never verify, so
 * accepting one would only store a broken config.
 */
export class PutAppConfigDto {
  @IsString() @MinLength(1) @MaxLength(200) appId!: string;
  @IsString() @MinLength(1) @MaxLength(500) appSecret!: string;
}

/**
 * CC8 — save the tenant's OWN LLM key. Provider must be a real
 * provider (the dev adapter is not a key a tenant can bring);
 * both provider and key are required — the row is written only
 * after a real completion verifies the pair.
 */
export class PutLlmConfigDto {
  @IsString() @IsIn(["openai", "anthropic", "gemini"]) provider!: string;
  @IsString() @MinLength(1) @MaxLength(500) apiKey!: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
}

/**
 * CC9 — save the tenant's OWN payment gateway. All fields are
 * optional at the DTO level because each provider needs a
 * different subset; the service enforces the per-provider
 * required set and refuses before saving anything.
 */
export class PutPaymentGatewayDto {
  // sslcommerz
  @IsOptional() @IsString() @MaxLength(200) storeId?: string;
  @IsOptional() @IsString() @MaxLength(500) storePass?: string;
  // bkash
  @IsOptional() @IsString() @MaxLength(200) username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsOptional() @IsString() @MaxLength(200) appKey?: string;
  @IsOptional() @IsString() @MaxLength(500) appSecret?: string;
  // nagad
  @IsOptional() @IsString() @MaxLength(200) merchantId?: string;
  @IsOptional() @IsString() @MaxLength(10000) privateKey?: string;
  // shurjopay (GC11) — username/password above are shared with
  // bkash; prefix is ShurjoPay's own field, storeId optional.
  @IsOptional() @IsString() @MaxLength(100) prefix?: string;
  // aamarpay (GC11) — storeId above is shared with sslcommerz.
  @IsOptional() @IsString() @MaxLength(500) signatureKey?: string;
  // stripe (OU5) — the tenant's OWN Stripe account: secret key
  // + webhook signing secret are both required by the service
  // (a session whose completion could not be signature-verified
  // must never be creatable); the publishable key is a
  // non-secret identifier.
  @IsOptional() @IsString() @MaxLength(500) secretKey?: string;
  @IsOptional() @IsString() @MaxLength(500) webhookSecret?: string;
  @IsOptional() @IsString() @MaxLength(200) publishableKey?: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
  // GC12: the merchant's OWN gateway-contract fee numbers —
  // plain columns on the gateway row, NOT part of the sealed
  // creds. Key-presence semantics in the service: key present
  // (including explicit null) = set/clear the column; key
  // absent = column untouched, so a creds-only re-save never
  // wipes fees. feeFixedMinor crosses as a decimal string of
  // minor units (BigInt-safe), validated in the service.
  @IsOptional() @IsInt() @Min(0) @Max(10000) feeBps?: number | null;
  @IsOptional() @IsString() @MaxLength(30) feeFixedMinor?: string | null;
  // CC19: which credential set this save targets. Only an
  // EXPLICIT "sandbox" creates/targets the sandbox set; absent
  // means the live (primary) set, where the legacy sandbox
  // checkbox keeps its CC9 meaning inside the credentials.
  @IsOptional() @IsString() @IsIn(["live", "sandbox"]) environment?: string;
}

/**
 * CC17 — set an account's tenant-chosen label and/or free-text
 * group. Both optional (partial updates); null clears. Length is
 * enforced again in the service (AD6 discipline: trim, ≤60).
 */
export class AccountMetaDto {
  @IsOptional() @IsString() @MaxLength(200) label?: string | null;
  @IsOptional() @IsString() @MaxLength(200) groupName?: string | null;
}

/** CC18 — pause/resume one Integration's syncs. */
export class SetSyncPausedDto {
  @IsBoolean() syncPaused!: boolean;
}

/** CC30 — set/clear one Integration's SCHEDULED-sync cadence
 * (minutes between scheduled syncs of the same kind). null
 * clears back to "no cadence". The range is enforced again in
 * the service: 5 minutes (below that a cadence is meaningless
 * against the job templates) to 10080 (one week). */
export class SetSyncIntervalDto {
  @IsOptional() @IsInt() @Min(5) @Max(10080) syncIntervalMinutes!: number | null;
}

/** CC17 — replace a member's denied-connection list wholesale
 * (the matrix UI sends the full set; the service validates every
 * id against real account rows of the org). */
export class SetMemberDeniedConnectionsDto {
  @IsArray() @IsString({ each: true }) deniedConnectionIds!: string[];
}

/** CC19 — initiate a clearly-labelled sandbox TEST payment
 * against the org's sandbox credential set. */
export class TestInitiatePaymentDto {
  @IsOptional() @IsInt() @Min(100) @Max(100000) amountMinor?: number;
}

export class SetGatewayEnabledDto {
  @IsBoolean() isEnabled!: boolean;
  /** CC23: TOTP step-up code — required when DISABLING and
   * the acting user has TOTP enabled (M35). */
  @IsOptional() @IsString() @MaxLength(10) totpCode?: string;
}

/** CC21 — the tenant's auto-healing opt-out for one
 * connection (detection/alerts are unaffected). */
export class SetAutoHealDto {
  @IsBoolean() autoHealEnabled!: boolean;
}

export class InitiateOrderPaymentDto {
  @IsString() @MinLength(1) @MaxLength(100) orderId!: string;
  @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @IsOptional() @IsString() @MaxLength(30) customerPhone?: string;
  @IsOptional() @IsString() @MaxLength(200) customerEmail?: string;
}

/** Public storefront pay-initiation: order id + the order's
 * human number (the tracking-lookup discipline). */
export class PublicInitiatePaymentDto {
  @IsString() @MinLength(1) @MaxLength(100) orderId!: string;
  @IsString() @MinLength(1) @MaxLength(60) orderNumber!: string;
  @IsString() @IsIn(["sslcommerz", "bkash", "shurjopay", "aamarpay", "stripe"]) provider!: string;
  /** CC10: "platform" pays through the platform gateway (wallet
   * credit); omitted/"own" is the CC9 tenant-gateway path.
   * OU5: stripe exists ONLY as an own gateway — the pair is
   * re-validated against publicPaymentOptions, which never
   * offers stripe on the platform path. */
  @IsOptional() @IsString() @IsIn(["own", "platform"]) source?: string;
  /** AB4 (AX5a): which slice this initiation collects —
   * "deposit" prices from the org's deposit config, "balance"
   * collects the remaining amount; omitted/"full" is legacy. */
  @IsOptional() @IsString() @IsIn(["full", "deposit", "balance"]) purpose?: string;
}

/** CC10 — toggle the tenant's platform-payment enablement for
 * one provider. */
export class SetPlatformEnabledDto {
  @IsBoolean() isEnabled!: boolean;
}

/** CC12 — per-org connection-alert preferences. categories
 * null/absent = every category alerts; doctorEnabled opts the
 * sweep into live Doctor runs on its conservative cadence. */
export class PutAlertPreferencesDto {
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[] | null;
  @IsOptional() @IsBoolean() doctorEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) doctorIntervalHours?: number;
}

/** CC12 — snooze one target's alerts for N hours (0 = clear the
 * snooze). While snoozed the sweep neither updates the target's
 * alert state nor notifies. */
export class SnoozeTargetDto {
  @IsInt() @Min(0) @Max(24 * 30) hours!: number;
}

/** CC10 — request a wallet payout. amountMinor is a decimal
 * string of minor units (validated server-side as an integer);
 * destination carries the tenant's payout details (bKash number
 * or bank account fields), validated per method server-side. */
export class CreatePayoutRequestDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) amountMinor?: string;
  @IsOptional() @IsString() @IsIn(["bkash", "bank"]) method?: string;
  @IsOptional() @IsObject() destination?: Record<string, unknown>;
  /** CC26: pay out to a SAVED PayoutDestination instead of
   * free-form details — the service snapshots the destination's
   * method + details onto the request. When set, method and
   * destination above are ignored. */
  @IsOptional() @IsString() @MaxLength(100) destinationId?: string;
  /** CC23: TOTP step-up code — required when the acting user
   * has TOTP enabled (M35); absent enrolment proceeds with a
   * stepUpUnavailable note in the response. */
  @IsOptional() @IsString() @MaxLength(10) totpCode?: string;
}

/** CC24 — initiate a gateway refund against one verified
 * payment. amountMinor omitted = the full remaining refundable
 * amount; the service enforces the cumulative cap. */
export class InitiateRefundDto {
  @IsOptional() @IsString() @MaxLength(30) amountMinor?: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** OU5 — Refund Center: open a MANUAL refund request for a
 * provider without a refund API (or a gateway-manual case).
 * Same amount/reason shape as the gateway initiation. */
export class CreateManualRefundDto {
  @IsOptional() @IsString() @MaxLength(30) amountMinor?: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** OU5 — record the provider-dashboard action for a manual
 * refund: the dashboard's own reference is required (a manual
 * refund without a provider reference is not recordable); the
 * proof note is the staff member's attestation detail. */
export class RecordManualRefundDto {
  @IsString() @MinLength(1) @MaxLength(200) providerRef!: string;
  @IsOptional() @IsString() @MaxLength(500) proofNote?: string;
}

/** CC25 — import a gateway settlement CSV for reconciliation.
 * v1 carries the file as CSV TEXT in the body (no multipart):
 * capped at ~2MB, which is far beyond a monthly settlement
 * export. periodFrom/periodTo are optional ISO dates bounding
 * the missing-in-report comparison set. */
export class CreateSettlementImportDto {
  @IsString() @IsIn(["sslcommerz", "bkash"]) provider!: string;
  @IsString() @IsIn(["own", "platform"]) source!: string;
  @IsString() @MinLength(1) @MaxLength(120) periodLabel!: string;
  @IsOptional() @IsString() @MaxLength(40) periodFrom?: string;
  @IsOptional() @IsString() @MaxLength(40) periodTo?: string;
  @IsString() @MinLength(1) @MaxLength(200) fileName!: string;
  @IsString() @MinLength(1) @MaxLength(2_000_000) csv!: string;
}

/** CC26 — save a payout destination. Details are validated per
 * method in the service (bKash number / bank account fields). */
export class CreatePayoutDestinationDto {
  @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsString() @IsIn(["bkash", "bank"]) method!: string;
  @IsObject() details!: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdatePayoutDestinationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) label?: string;
  @IsOptional() @IsObject() details?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** CC26 — the automatic payout-request schedule. thresholdMinor
 * is a decimal string of minor units; dayOfWeek (0=Sunday) for
 * weekly, dayOfMonth (1..28) for monthly — Asia/Dhaka days. */
export class PutPayoutScheduleDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @IsIn(["weekly", "monthly"]) cadence!: string;
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsString() @MinLength(1) @MaxLength(30) thresholdMinor!: string;
  @IsOptional() @IsString() @MaxLength(100) destinationId?: string | null;
}

/** CC26 — create a shareable payment link for one order. The
 * plaintext token is returned exactly once; expiry is bounded
 * to 1 hour .. 30 days by the service. */
export class CreatePaymentLinkDto {
  @IsString() @MinLength(1) @MaxLength(100) orderId!: string;
  @IsString() @IsIn(["sslcommerz", "bkash"]) provider!: string;
  @IsOptional() @IsString() @IsIn(["own", "platform"]) source?: string;
  @IsOptional() @IsInt() @Min(1) @Max(24 * 30) expiresInHours?: number;
}

/** CC20 — complete a Google-pack account pick: the single-use
 * pick state + the option id FROM the offered list (the server
 * re-checks membership — an invented id is refused). */
export class GoogleSelectDto {
  @IsString() @MinLength(1) state!: string;
  @IsString() @MinLength(1) optionId!: string;
}

/** CC20 — dismiss one Smart Setup Assistant finding for the
 * calling user. The key must be one the assistant can actually
 * produce (the service re-checks against its rule table). */
export class DismissAssistantFindingDto {
  @IsString() @MinLength(1) @MaxLength(80) findingKey!: string;
}

/**
 * GC10 — an online-payment selection on a public checkout DTO:
 * pay through a real gateway (the tenant's OWN, CC9, or the
 * PLATFORM's, CC10) instead of COD / a manual advance claim.
 * The pair is always re-validated server-side against
 * TenantPaymentsService.publicPaymentOptions — the client value
 * alone never enables a payment path.
 */
export class OnlinePaymentSelectionDto {
  // GC11: the OWN path also accepts shurjopay/aamarpay. The
  // source pair is still re-validated against
  // publicPaymentOptions, which never offers the new providers
  // on the platform path — a platform+shurjopay/aamarpay pair
  // is refused there, not here.
  // OU5: stripe joins the OWN path the same way (never offered
  // on the platform path for shop orders).
  @IsString() @IsIn(["sslcommerz", "bkash", "shurjopay", "aamarpay", "stripe"]) provider!: string;
  @IsString() @IsIn(["own", "platform"]) source!: string;
}
