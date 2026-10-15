-- CC29 (Connect Center Next, B12): courier multi-account.
--
-- CourierShipment.integrationId: the courier ACCOUNT (Integration
-- row) the shipment was booked under. Courier accounts are keyed
-- (organizationId, provider, externalAccountId) from CC29 on —
-- the externalAccountId is a credential fingerprint (no courier's
-- verify response carries a real account id; see
-- docs/connect-center-b12-acceptance.md) — so a provider can hold
-- several accounts, and status sync must read the shipment's OWN
-- account's credentials. Nullable: pre-CC29 shipments carry NULL
-- and their sync falls back to the provider's resolved default
-- account.
--
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked in the full fresh-Postgres run).

-- AlterTable
ALTER TABLE "CourierShipment" ADD COLUMN "integrationId" TEXT;

-- CreateIndex
CREATE INDEX "CourierShipment_organizationId_integrationId_idx" ON "CourierShipment"("organizationId", "integrationId");
