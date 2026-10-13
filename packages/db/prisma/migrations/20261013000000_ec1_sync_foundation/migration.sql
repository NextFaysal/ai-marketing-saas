-- EC1 (Sync Foundation): StoreListing + SyncOutbox + SyncConflict,
-- plus Store.syncMode / Store.fieldOwnership.
-- All additive: existing stores default to syncMode "mirror" (the
-- pre-EC1 inbound-only behaviour) and no existing row is rewritten.
-- NOT run on any real DB from the build sandbox; required at deploy.

ALTER TABLE "Store" ADD COLUMN "syncMode" TEXT NOT NULL DEFAULT 'mirror';
ALTER TABLE "Store" ADD COLUMN "fieldOwnership" JSONB;

-- CreateTable
CREATE TABLE "StoreListing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalVariantMap" JSONB,
    "publishState" TEXT NOT NULL DEFAULT 'published',
    "channelPriceMinor" BIGINT,
    "channelStock" INTEGER,
    "lastPushedHash" TEXT,
    "lastRemoteHash" TEXT,
    "lastRemoteUpdatedAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'synced',
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "responseSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "localValue" JSONB,
    "remoteValue" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreListing_storeId_productId_key" ON "StoreListing"("storeId", "productId");
CREATE INDEX "StoreListing_organizationId_syncStatus_idx" ON "StoreListing"("organizationId", "syncStatus");
CREATE INDEX "StoreListing_organizationId_storeId_idx" ON "StoreListing"("organizationId", "storeId");
CREATE INDEX "StoreListing_storeId_externalId_idx" ON "StoreListing"("storeId", "externalId");
CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key" ON "SyncOutbox"("idempotencyKey");
CREATE INDEX "SyncOutbox_organizationId_status_nextRetryAt_idx" ON "SyncOutbox"("organizationId", "status", "nextRetryAt");
CREATE INDEX "SyncOutbox_organizationId_storeId_status_idx" ON "SyncOutbox"("organizationId", "storeId", "status");
CREATE INDEX "SyncConflict_organizationId_status_idx" ON "SyncConflict"("organizationId", "status");
CREATE INDEX "SyncConflict_listingId_idx" ON "SyncConflict"("listingId");

-- AddForeignKey
ALTER TABLE "StoreListing" ADD CONSTRAINT "StoreListing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreListing" ADD CONSTRAINT "StoreListing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreListing" ADD CONSTRAINT "StoreListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncOutbox" ADD CONSTRAINT "SyncOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StoreListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
