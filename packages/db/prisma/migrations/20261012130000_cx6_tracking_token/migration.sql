-- CX6: per-shipment public live-tracking token (ReportShare/M59
-- pattern: randomBytes(24) base64url, minted lazily on the first
-- customer update or manual share). Null = no public link yet.
-- Unique when present; the token alone is the public credential.
ALTER TABLE "CourierShipment" ADD COLUMN "trackingToken" TEXT;

CREATE UNIQUE INDEX "CourierShipment_trackingToken_key" ON "CourierShipment"("trackingToken");
