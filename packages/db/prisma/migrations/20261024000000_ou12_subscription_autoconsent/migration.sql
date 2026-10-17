-- OU12 (One-Umbrella): shop subscription auto-charge CONSENT
-- capture on CustomerSubscription. All additive + nullable;
-- existing rows have no consent on record (all three NULL) and
-- their renewal behaviour is unchanged (COD/manual). Consent is
-- recorded with a server timestamp; it does NOT activate any
-- charging — no shop tokenized charge path exists in-repo (see
-- docs/one-umbrella-ou12-section.md).

ALTER TABLE "CustomerSubscription" ADD COLUMN "autoChargeConsentAt" TIMESTAMP(3);
ALTER TABLE "CustomerSubscription" ADD COLUMN "autoChargeConsentMethod" TEXT;
ALTER TABLE "CustomerSubscription" ADD COLUMN "autoChargeConsentNote" TEXT;
