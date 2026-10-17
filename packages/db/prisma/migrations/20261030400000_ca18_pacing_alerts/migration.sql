-- CB5 (Campaign Builder Advanced, CA18) — migration claim
-- 20261030400000 (CB5's first migration; CB1 used
-- 20261030000000, CB2 20261030100000, CB3 20261030200000,
-- CB4 20261030300000).
--
-- CA18: PlanPacingAlert — one row per pacing alert the
-- per-org pacing_alert_sweep raises from REAL DailyAdMetric
-- rows (early_exhaustion | overspend_pace). status active |
-- cleared is the dedupe key: at most one ACTIVE row per
-- (planId, kind) is maintained by the sweep; cleared rows
-- stay as history. detail (JSONB) carries the exact numbers
-- behind the alert. Additive new table; nothing existing is
-- touched.
CREATE TABLE "PlanPacingAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "message" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPacingAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanPacingAlert_organizationId_planId_status_idx" ON "PlanPacingAlert"("organizationId", "planId", "status");
CREATE INDEX "PlanPacingAlert_organizationId_status_idx" ON "PlanPacingAlert"("organizationId", "status");
