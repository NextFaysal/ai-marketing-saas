-- IN3: Inbox macros (personal + team-shared one-click action sequences).
-- Additive only: one new table, no changes to existing tables,
-- no backfill. Deleting the table would only remove macro
-- definitions — no conversation or message data lives here.
CREATE TABLE "InboxMacro" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMacro_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboxMacro_organizationId_userId_idx" ON "InboxMacro"("organizationId", "userId");
CREATE INDEX "InboxMacro_organizationId_shared_idx" ON "InboxMacro"("organizationId", "shared");
