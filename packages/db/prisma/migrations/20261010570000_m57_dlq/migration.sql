-- Milestone 57: dead-letter queue for exhausted scheduled jobs.
CREATE TABLE "DeadLetterJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "scheduledJobId" TEXT,
  "jobType" TEXT,
  "error" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replayedAt" TIMESTAMP(3),
  CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeadLetterJob_createdAt_idx" ON "DeadLetterJob"("createdAt");
