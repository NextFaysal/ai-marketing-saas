-- NF6 (FB3): Gamified promotions — spin wheel, product-finder
-- quiz, group buy. Hand-written to match schema.prisma exactly
-- (the repo's hand-written migration style). Three new
-- org-scoped tables only; NO columns are added to existing
-- tables. Prizes are NOT stored here as money: a win issues a
-- REAL single-use StoreDiscount through the existing coupon
-- engine (origin "gamified_promo") and only the issued row's
-- id/code are stamped back onto the play / join record.
-- PromoPlay (campaignId, phoneKey) unique IS the
-- one-play-per-phone rule; phoneKey is the Fraud Shield /
-- BlockedPhone match key. Group-buy joins are records, never
-- stock holds and never payments.

CREATE TABLE "PromoCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL DEFAULT 'delay_seconds',
    "delaySeconds" INTEGER NOT NULL DEFAULT 5,
    "scrollPercent" INTEGER NOT NULL DEFAULT 50,
    "frequencyDays" INTEGER NOT NULL DEFAULT 7,
    "showOn" TEXT NOT NULL DEFAULT 'home',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoPlay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "customerName" TEXT,
    "outcome" TEXT NOT NULL,
    "segmentIndex" INTEGER,
    "segmentLabel" TEXT,
    "resultKey" TEXT,
    "couponId" TEXT,
    "couponCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoPlay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoGroupBuyJoin" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'joined',
    "couponId" TEXT,
    "couponCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoGroupBuyJoin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromoCampaign_organizationId_kind_active_idx" ON "PromoCampaign"("organizationId", "kind", "active");

CREATE UNIQUE INDEX "PromoPlay_campaignId_phoneKey_key" ON "PromoPlay"("campaignId", "phoneKey");
CREATE INDEX "PromoPlay_organizationId_campaignId_createdAt_idx" ON "PromoPlay"("organizationId", "campaignId", "createdAt");

CREATE UNIQUE INDEX "PromoGroupBuyJoin_campaignId_phoneKey_key" ON "PromoGroupBuyJoin"("campaignId", "phoneKey");
CREATE INDEX "PromoGroupBuyJoin_organizationId_campaignId_status_idx" ON "PromoGroupBuyJoin"("organizationId", "campaignId", "status");

ALTER TABLE "PromoCampaign" ADD CONSTRAINT "PromoCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoPlay" ADD CONSTRAINT "PromoPlay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoGroupBuyJoin" ADD CONSTRAINT "PromoGroupBuyJoin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
