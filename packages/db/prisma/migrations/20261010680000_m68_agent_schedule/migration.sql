-- Milestone 68 (Team T2): per-agent weekly working hours.
CREATE TABLE "AgentSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "windows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSchedule_organizationId_userId_key" ON "AgentSchedule"("organizationId", "userId");
CREATE INDEX "AgentSchedule_organizationId_idx" ON "AgentSchedule"("organizationId");
