-- CC14/CC15 (Connect Center Advanced): provider-reported health
-- snapshots on the three rows that own provider connections —
-- Integration (WhatsApp deep health; Meta Page completeness for
-- messaging/meta_social integrations), SocialAccount (Meta Page
-- completeness for social accounts) and AdAccount (Meta
-- payment-method-on-file boolean). Values are stored VERBATIM
-- from the provider: a field the provider did not return stays
-- absent from the JSON snapshot, never 0, never estimated.
-- providerHealthAt moves ONLY on a successful fetch; a failed
-- fetch sets providerHealthError and leaves snapshot + timestamp
-- untouched, so stale values can never masquerade as fresh.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013310000_cc11_health_checks).

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "providerHealth" JSONB;
ALTER TABLE "Integration" ADD COLUMN "providerHealthAt" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN "providerHealthError" TEXT;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "providerHealth" JSONB;
ALTER TABLE "SocialAccount" ADD COLUMN "providerHealthAt" TIMESTAMP(3);
ALTER TABLE "SocialAccount" ADD COLUMN "providerHealthError" TEXT;

-- AlterTable
ALTER TABLE "AdAccount" ADD COLUMN "providerHealth" JSONB;
ALTER TABLE "AdAccount" ADD COLUMN "providerHealthAt" TIMESTAMP(3);
ALTER TABLE "AdAccount" ADD COLUMN "providerHealthError" TEXT;
