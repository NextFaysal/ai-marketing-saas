-- EC12 (WooCommerce wc-auth 1-click connect): WcAuthAttempt.
-- All additive: one new table only.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "WcAuthAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WcAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WcAuthAttempt_state_key" ON "WcAuthAttempt"("state");
CREATE INDEX "WcAuthAttempt_organizationId_idx" ON "WcAuthAttempt"("organizationId");
CREATE INDEX "WcAuthAttempt_expiresAt_idx" ON "WcAuthAttempt"("expiresAt");
