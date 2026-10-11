-- Referral Advanced R4: campaign codes + milestone awards.
ALTER TABLE "Referral" ALTER COLUMN "referrerUserId" DROP NOT NULL;
ALTER TABLE "Referral" ADD COLUMN "termsSnapshot" JSONB;
CREATE TABLE "ReferralCampaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT,
    "rewardMinor" BIGINT,
    "percentOfFirstPayment" INTEGER,
    "refereeBonusMinor" BIGINT,
    "minFirstPaymentMinor" BIGINT,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReferralCampaign_code_key" ON "ReferralCampaign"("code");
CREATE TABLE "ReferralMilestoneAward" (
    "id" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "bonusMinor" BIGINT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralMilestoneAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReferralMilestoneAward_referrerUserId_threshold_key" ON "ReferralMilestoneAward"("referrerUserId", "threshold");
