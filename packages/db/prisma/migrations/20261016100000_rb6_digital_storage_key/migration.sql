-- RB6/RM9: Product.digitalStorageKey — the platform-hosted
-- (private R2 bucket) digital product file, as a storage KEY.
-- Nullable and additive: every existing row keeps behaving
-- exactly as before (merchant-hosted digitalFileUrl only).
ALTER TABLE "Product" ADD COLUMN "digitalStorageKey" TEXT;
