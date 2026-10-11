-- AD6: per-account display label (free text, nullable; falls back
-- to the platform account name when unset).
ALTER TABLE "AdAccount" ADD COLUMN "label" TEXT;
