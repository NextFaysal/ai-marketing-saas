-- Workflows W6: governance — per-entity cooldown + daily run cap.
ALTER TABLE "Workflow" ADD COLUMN "cooldownMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workflow" ADD COLUMN "dailyRunCap" INTEGER;
