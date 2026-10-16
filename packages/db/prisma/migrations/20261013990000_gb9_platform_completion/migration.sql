-- GB9 (GC21 Merchant trust + GC22 Plan enforcement + GC23 API & Support):
--  * User.emailVerifiedAt / phoneVerifiedAt / phone + VerificationToken:
--    registration email verification (hashed token, 24h) and platform
--    phone OTP (hashed code, 5 min, attempt-capped). Existing users
--    keep NULL stamps — the enforcement gate grandfathers them.
--  * Organization.verificationStatus/Note/SubmittedAt + BusinessProfile
--    tradeLicenseNo/businessAddress: the merchant verification workflow.
--  * Subscription.pausedAt: pause stamp (status vocabulary unchanged).
--  * TenantPaymentTransaction.failureNotifiedAt: payment-failure staff
--    alert dedupe (exactly one alert opportunity per attempt).
--  * SupportTicket.category/firstRespondedAt: ticket categories + SLA.
--  * WebhookSubscription/WebhookDelivery: outgoing merchant webhooks
--    (secret sealed; retry 1m → 5m → 30m → 2h, 5 attempts max).
--  * ApiUsageDaily: per-org daily public-API counter (plan apiDailyLimit).
-- All additive: existing rows keep the new columns NULL / defaulted.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE "Organization" ADD COLUMN "verificationNote" TEXT;
ALTER TABLE "Organization" ADD COLUMN "verificationSubmittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN "tradeLicenseNo" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "businessAddress" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "failureNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "SupportTicket" ADD COLUMN "firstRespondedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "error" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsageDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationToken_userId_kind_idx" ON "VerificationToken"("userId", "kind");

-- CreateIndex
CREATE INDEX "WebhookSubscription_organizationId_active_idx" ON "WebhookSubscription"("organizationId", "active");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextRetryAt_idx" ON "WebhookDelivery"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_idx" ON "WebhookDelivery"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organizationId_createdAt_idx" ON "WebhookDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsageDaily_organizationId_day_key" ON "ApiUsageDaily"("organizationId", "day");

-- CreateIndex
CREATE INDEX "ApiUsageDaily_organizationId_day_idx" ON "ApiUsageDaily"("organizationId", "day");

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageDaily" ADD CONSTRAINT "ApiUsageDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
