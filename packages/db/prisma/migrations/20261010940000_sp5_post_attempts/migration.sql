-- Social Media Post Scheduler SP5 (Scheduling + Publish Worker):
-- SocialPost gains an attempts counter — how many publish attempts
-- the worker has used for the current scheduled run. The publish
-- worker caps retries (MAX_PUBLISH_ATTEMPTS) with backoff; a
-- failed post that is re-scheduled resets the counter to 0 while
-- keeping its last error visible until the next attempt.

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
