-- Billing Package B2: proration line + scheduled plan change.
ALTER TABLE "Subscription" ADD COLUMN "pendingPlan" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "pendingPlanAt" TIMESTAMP(3);
ALTER TABLE "PlanCheckout" ADD COLUMN "prorationMinor" BIGINT NOT NULL DEFAULT 0;
