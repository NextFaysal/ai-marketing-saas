-- CC11/CC12 (Connect Center Advanced): Connection Doctor runs
-- (ConnectionHealthCheck — per-step records of REAL provider
-- checks only; a kind with no real check is stored as
-- "not_checkable", never a guessed pass), the monitoring sweep's
-- per-target alert bookkeeping (ConnectionAlertState — alerts
-- fire only on state changes), the delivered-alert records the
-- Connect Center counts unread (ConnectionAlert — email delivery
-- counted only by real EmailProvider message ids), and the
-- per-org alert preferences (ConnectionAlertPreference).
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013300000_cp_completion).

-- CreateTable
CREATE TABLE "ConnectionHealthCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "integrationId" TEXT,
    "provider" TEXT,
    "category" TEXT,
    "displayName" TEXT,
    "runById" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "overall" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionAlertState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "provider" TEXT,
    "category" TEXT,
    "displayName" TEXT,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "stateHash" TEXT NOT NULL DEFAULT '',
    "doctorState" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionAlertState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "provider" TEXT,
    "category" TEXT,
    "displayName" TEXT,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "emailSentCount" INTEGER NOT NULL DEFAULT 0,
    "emailError" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionAlertPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "categories" JSONB,
    "doctorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "doctorIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionAlertPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectionHealthCheck_organizationId_targetType_targetId_cr_idx" ON "ConnectionHealthCheck"("organizationId", "targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectionHealthCheck_organizationId_createdAt_idx" ON "ConnectionHealthCheck"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectionAlertState_organizationId_idx" ON "ConnectionAlertState"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionAlertState_organizationId_targetKey_key" ON "ConnectionAlertState"("organizationId", "targetKey");

-- CreateIndex
CREATE INDEX "ConnectionAlert_organizationId_readAt_createdAt_idx" ON "ConnectionAlert"("organizationId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectionAlert_organizationId_targetKey_createdAt_idx" ON "ConnectionAlert"("organizationId", "targetKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionAlertPreference_organizationId_key" ON "ConnectionAlertPreference"("organizationId");

