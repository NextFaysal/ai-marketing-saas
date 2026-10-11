-- Milestone 48 (Proactive Assistant): per-org briefing/alert switches.
CREATE TABLE "AIProactiveSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "briefingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "anomalyAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIProactiveSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AIProactiveSetting_organizationId_key" ON "AIProactiveSetting"("organizationId");
ALTER TABLE "AIProactiveSetting" ADD CONSTRAINT "AIProactiveSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
