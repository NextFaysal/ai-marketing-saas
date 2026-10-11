-- Reports Advanced RP6: share kind (overview | executive).
ALTER TABLE "ReportShare" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'overview';
