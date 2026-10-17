-- TD11 (Tenant Domain): slug cooldown tombstone — a permanently
-- deleted organization's slug stays reserved for 180 days so a
-- new org cannot take over the deleted shop's subdomain address.
-- CreateTable
CREATE TABLE "SlugTombstone" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "deletedOrgName" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlugTombstone_slug_key" ON "SlugTombstone"("slug");

-- CreateIndex
CREATE INDEX "SlugTombstone_expiresAt_idx" ON "SlugTombstone"("expiresAt");
