-- MX11: Predictive Audiences & Engagement Score.
-- Additive only, no backfill:
--   Broadcast.holdoutPercent / holdoutCount — the org-set
--     holdout percentage for a broadcast (NULL = no holdout,
--     every pre-MX11 row) and the held-out count stamped at
--     prepare time. Held-out recipients are excluded at
--     prepare by a bucket of the same deterministic hash the
--     A/B split uses; they are never materialized as recipient
--     rows, so resume cannot re-roll them.
--   MessagingSetting predictive thresholds — churn-risk silent
--     days, likely-to-buy minimum engagement score, high-LTV
--     minimum total spent (minor units), and the unengaged
--     suppression-suggestion rule (days + minimum sends).
--     Suggestions only: no row here ever suppresses anyone by
--     itself; suppression stays a human-confirmed preference
--     write through the MX10 machinery.
-- The engagement score itself is NOT stored (computed on read,
-- the RFM precedent) — this migration adds no score table.
ALTER TABLE "Broadcast" ADD COLUMN "holdoutPercent" INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN "holdoutCount" INTEGER;

ALTER TABLE "MessagingSetting" ADD COLUMN "churnRiskSilentDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "MessagingSetting" ADD COLUMN "likelyToBuyMinScore" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "MessagingSetting" ADD COLUMN "highLtvMinSpentMinor" INTEGER NOT NULL DEFAULT 500000;
ALTER TABLE "MessagingSetting" ADD COLUMN "unengagedSuppressDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "MessagingSetting" ADD COLUMN "unengagedMinSends" INTEGER NOT NULL DEFAULT 3;
