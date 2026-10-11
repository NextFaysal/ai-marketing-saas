-- Reports Advanced RP5: monthly metric targets.
CREATE TABLE "ReportGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" BIGINT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportGoal_organizationId_month_metric_key" ON "ReportGoal"("organizationId", "month", "metric");
CREATE INDEX "ReportGoal_organizationId_idx" ON "ReportGoal"("organizationId");
