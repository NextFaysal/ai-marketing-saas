-- MS10: broadcast archive.
-- Additive only, no backfill:
--   Broadcast.archivedAt — when set, the broadcast is archived:
--   hidden from the default broadcast list (the list opts back
--   in with ?archived=1) and refused by send/schedule until
--   unarchived. Sent-family broadcasts (sent | partial | failed)
--   can never be deleted (their deliveries are the history), so
--   archive is their retire path; delete stays draft/cancelled
--   only. NULL = not archived (every pre-MS10 row).
ALTER TABLE "Broadcast" ADD COLUMN "archivedAt" TIMESTAMP(3);
