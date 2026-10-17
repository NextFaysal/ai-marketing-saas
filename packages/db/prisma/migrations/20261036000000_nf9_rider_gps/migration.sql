-- NF9 (FB4): Rider live GPS + fleet view.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). Three new org-scoped tables
-- only; NO columns are added to existing tables.
--
-- RiderShareLink: one row per rider (riderId unique). Only the
-- SHA-256 hex hash of the share token is stored — the raw token
-- is returned once at issue/rotation and never persisted (the
-- OrgInviteLink / payment-link pattern). sharingEnabled is the
-- rider's own ON/OFF switch; revokedAt is the staff kill switch;
-- expiresAt (issue + 30 days) makes an old link die on its own.
--
-- RiderLocationPing: the bounded trail — one row per accepted
-- ping under an active DeliveryAssignment, pruned in the
-- service to at most 200 rows per assignment (oldest first).
--
-- RiderLocationLatest: exactly one row per rider (riderId
-- unique), UPSERTED on every accepted ping. Fleet view and
-- customer tracking read only this row; a fix older than
-- 5 minutes is labelled stale, never live.

CREATE TABLE "RiderShareLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sharingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderShareLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiderLocationPing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "deliveryAssignmentId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderLocationPing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiderLocationLatest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "deliveryAssignmentId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderLocationLatest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiderShareLink_riderId_key" ON "RiderShareLink"("riderId");
CREATE UNIQUE INDEX "RiderShareLink_tokenHash_key" ON "RiderShareLink"("tokenHash");
CREATE INDEX "RiderShareLink_organizationId_riderId_idx" ON "RiderShareLink"("organizationId", "riderId");

CREATE INDEX "RiderLocationPing_organizationId_riderId_recordedAt_idx" ON "RiderLocationPing"("organizationId", "riderId", "recordedAt");
CREATE INDEX "RiderLocationPing_organizationId_deliveryAssignmentId_recordedAt_idx" ON "RiderLocationPing"("organizationId", "deliveryAssignmentId", "recordedAt");
CREATE INDEX "RiderLocationPing_riderId_idx" ON "RiderLocationPing"("riderId");
CREATE INDEX "RiderLocationPing_deliveryAssignmentId_idx" ON "RiderLocationPing"("deliveryAssignmentId");

CREATE UNIQUE INDEX "RiderLocationLatest_riderId_key" ON "RiderLocationLatest"("riderId");
CREATE INDEX "RiderLocationLatest_organizationId_riderId_idx" ON "RiderLocationLatest"("organizationId", "riderId");
CREATE INDEX "RiderLocationLatest_deliveryAssignmentId_idx" ON "RiderLocationLatest"("deliveryAssignmentId");

ALTER TABLE "RiderShareLink" ADD CONSTRAINT "RiderShareLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderShareLink" ADD CONSTRAINT "RiderShareLink_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiderLocationPing" ADD CONSTRAINT "RiderLocationPing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderLocationPing" ADD CONSTRAINT "RiderLocationPing_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderLocationPing" ADD CONSTRAINT "RiderLocationPing_deliveryAssignmentId_fkey" FOREIGN KEY ("deliveryAssignmentId") REFERENCES "DeliveryAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiderLocationLatest" ADD CONSTRAINT "RiderLocationLatest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderLocationLatest" ADD CONSTRAINT "RiderLocationLatest_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderLocationLatest" ADD CONSTRAINT "RiderLocationLatest_deliveryAssignmentId_fkey" FOREIGN KEY ("deliveryAssignmentId") REFERENCES "DeliveryAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
