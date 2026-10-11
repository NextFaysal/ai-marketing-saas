-- Social Media Post Scheduler SP4 (AI Image + Template Composer):
-- MediaAsset gains an origin marker (upload | ai_generated |
-- template) and the generation prompt for AI-produced assets, so
-- the library can distinguish tenant uploads from generated and
-- composed media. Existing rows default to "upload".

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "MediaAsset" ADD COLUMN "prompt" TEXT;
