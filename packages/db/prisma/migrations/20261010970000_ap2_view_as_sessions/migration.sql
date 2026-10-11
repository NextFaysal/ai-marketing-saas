-- Admin Polish AP2: view-as session registry (revocation).
CREATE TABLE "ViewAsSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewAsSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ViewAsSession_adminId_revokedAt_idx" ON "ViewAsSession"("adminId", "revokedAt");
CREATE INDEX "ViewAsSession_organizationId_idx" ON "ViewAsSession"("organizationId");
