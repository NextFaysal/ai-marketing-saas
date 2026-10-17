-- MX16: Analytics & AI v2 — A/B auto-winner state.
-- Additive only, no backfill:
--   MessagingSetting.abAutoWinnerEnabled — org switch for the
--     A/B auto-winner (owner decision D3), default FALSE =
--     pre-MX16 behaviour for every existing org (the report's
--     winner stays a suggestion only).
--   Broadcast.abAutoWinnerEnabled — per-pair override;
--     NULL = inherit the org switch. An explicit false on
--     either variant disables the pair.
--   Broadcast.abWinnerVariant / abWinnerAt / abWinnerDetail —
--     the ONE auto-winner decision record (variant, timestamp,
--     and the z-test inputs/result as Json); NULL on every
--     pre-MX16 row (= no decision taken).
ALTER TABLE "MessagingSetting" ADD COLUMN "abAutoWinnerEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Broadcast" ADD COLUMN "abAutoWinnerEnabled" BOOLEAN;
ALTER TABLE "Broadcast" ADD COLUMN "abWinnerVariant" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "abWinnerAt" TIMESTAMP(3);
ALTER TABLE "Broadcast" ADD COLUMN "abWinnerDetail" JSONB;
