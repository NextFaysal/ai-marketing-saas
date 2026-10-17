-- ORG10 (Organization Next OB3): join-request approval queue.
-- A signed-in user following an OrgInviteLink creates one of
-- these instead of a membership; OWNER/ADMIN approval is the only
-- path from request to ACTIVE membership (seat-guarded at that
-- moment). At most one PENDING row per (userId, organizationId),
-- enforced in the service — Prisma has no partial unique index.
CREATE TABLE "OrgJoinRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inviteLinkId" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgJoinRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrgJoinRequest_organizationId_status_idx" ON "OrgJoinRequest"("organizationId", "status");
CREATE INDEX "OrgJoinRequest_userId_organizationId_idx" ON "OrgJoinRequest"("userId", "organizationId");
