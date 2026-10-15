-- Campaign Builder Next CN2 (NB1): true campaign budget
-- (budgetMode abo|cbo + campaign-level daily/lifetime
-- budgets on CampaignPlan) and per-ad-set bidding
-- (strategy + bid/cost amounts in minor units + Meta's
-- raw roas_average_floor integer) on CampaignAdSet.
-- All columns are additive and nullable/defaulted, so
-- existing plans keep their exact pre-CN2 behaviour
-- (budgetMode defaults to "abo"; null bidStrategy means
-- lowest-cost, Meta's own default).
-- NOT run on any real DB from the build sandbox; the
-- full sequence is verified on a fresh Postgres only.

-- AlterTable
ALTER TABLE "CampaignPlan" ADD COLUMN "budgetMode" TEXT NOT NULL DEFAULT 'abo';
ALTER TABLE "CampaignPlan" ADD COLUMN "campaignDailyBudgetMinor" BIGINT;
ALTER TABLE "CampaignPlan" ADD COLUMN "campaignLifetimeBudgetMinor" BIGINT;

-- AlterTable
ALTER TABLE "CampaignAdSet" ADD COLUMN "bidStrategy" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "bidAmountMinor" BIGINT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "costGoalMinor" BIGINT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "roasAverageFloor" INTEGER;
