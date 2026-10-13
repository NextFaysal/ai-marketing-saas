-- EC5 (Order Control Tower): per-store refund-push gate (DEFAULT
-- FALSE — plan §9 owner decision; see schema comment) + optional
-- courier tracking meta key, and the store-draft fields on Order.
-- All additive; no existing table shape or row is changed.
-- NOT run on any real DB from the build sandbox; required at deploy.

ALTER TABLE "Store" ADD COLUMN "refundPushEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN "courierTrackingMetaKey" TEXT;

ALTER TABLE "Order" ADD COLUMN "storeDraftId" TEXT;
ALTER TABLE "Order" ADD COLUMN "storeInvoiceUrl" TEXT;
