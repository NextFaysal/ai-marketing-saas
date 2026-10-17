-- MX8: Per-recipient Dynamic Personalization.
-- Additive only, no backfill:
--   Broadcast.personalizationConfig — the org's MX8 config for
--     the broadcast ({ uniqueCoupon, recommendations,
--     segmentBlocks }, validated by
--     messaging/personalization.ts). NULL on every pre-MX8 row
--     = no dynamic personalization, send behaviour byte-identical.
--   BroadcastRecipient.personalization — the per-recipient MX8
--     state computed at send time ({ couponCode,
--     couponDiscountId, couponError, recommendationSignal,
--     recommendationProductIds, segmentBlocksMatched }). It is
--     persisted BEFORE the provider call so resume/retry reuses
--     the already-issued unique coupon verbatim and never
--     issues a second StoreDiscount row for the same recipient.
--     NULL = not yet personalized. The unique coupons themselves
--     are ordinary StoreDiscount rows (origin "messaging_unique",
--     usageLimit 1, perCustomerLimit 1, sourceRef = broadcast
--     id) — no new coupon table is created.
ALTER TABLE "Broadcast" ADD COLUMN "personalizationConfig" JSONB;
ALTER TABLE "BroadcastRecipient" ADD COLUMN "personalization" JSONB;
