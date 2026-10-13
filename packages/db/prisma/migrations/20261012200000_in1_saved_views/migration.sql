-- IN1: Saved inbox views (personal + team-shared filter presets).
-- Additive only: one new table, no changes to existing tables,
-- no backfill. Deleting the table would only remove saved filter
-- presets — no conversation or message data lives here.
CREATE TABLE "InboxSavedView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxSavedView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboxSavedView_organizationId_userId_idx" ON "InboxSavedView"("organizationId", "userId");
CREATE INDEX "InboxSavedView_organizationId_shared_idx" ON "InboxSavedView"("organizationId", "shared");
