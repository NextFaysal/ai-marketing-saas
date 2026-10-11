-- Billing Package B3: yearly billing cycle.
ALTER TABLE "Subscription" ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "PlanCheckout" ADD COLUMN "cycle" TEXT NOT NULL DEFAULT 'monthly';
