-- ORG9 (Organization Next OB3): shareable, role-bound invite links.
-- A link never creates a membership by itself — it only produces
-- OrgJoinRequest rows (ORG10) that an OWNER/ADMIN must approve.
-- Only the SHA-256 hash of the token is stored, exactly like
-- MemberInvitation; the raw token exists only in the creation
-- response. maxUses is nullable in storage but the service never
-- treats null as unlimited (default cap 10 both ways).
CREATE TABLE "OrgInviteLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "tokenHash" TEXT NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgInviteLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgInviteLink_tokenHash_key" ON "OrgInviteLink"("tokenHash");
CREATE INDEX "OrgInviteLink_organizationId_idx" ON "OrgInviteLink"("organizationId");
