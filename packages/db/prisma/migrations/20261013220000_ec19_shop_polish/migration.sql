-- EC19 (Native Shop Polish): StorefrontSetting featuredMode +
-- locale, and the PaymentVerification order-advance extension.
-- All additive/backwards-compatible: conversationId/messageId
-- become nullable so a staff-recorded order advance (which has no
-- chat message behind it) can live in the same table; inbox
-- extraction rows keep setting both, exactly as before.
-- NOT run on any real DB from the build sandbox; required at
-- deploy.

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "featuredMode" TEXT NOT NULL DEFAULT 'merchant_picks';
ALTER TABLE "StorefrontSetting" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'bn';

-- AlterTable
ALTER TABLE "PaymentVerification" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "PaymentVerification" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "PaymentVerification" ADD COLUMN "orderId" TEXT;
ALTER TABLE "PaymentVerification" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "PaymentVerification" ADD COLUMN "source" TEXT;
ALTER TABLE "PaymentVerification" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "PaymentVerification" ADD COLUMN "note" TEXT;

-- CreateIndex
CREATE INDEX "PaymentVerification_organizationId_orderId_idx" ON "PaymentVerification"("organizationId", "orderId");
