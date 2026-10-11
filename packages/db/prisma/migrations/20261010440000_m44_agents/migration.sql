-- Unified Inbox U2 (Milestone 44): agent teams, capacities, agent state.
ALTER TABLE "ChannelConversation" ADD COLUMN "teamId" TEXT;
ALTER TABLE "InboxSetting" ADD COLUMN "reassignAfterMinutes" INTEGER;
ALTER TABLE "InboxSetting" ADD COLUMN "escalationTeamId" TEXT;

CREATE TABLE "InboxTeam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboxTeam_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboxTeam_organizationId_idx" ON "InboxTeam"("organizationId");

CREATE TABLE "InboxTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboxTeamMember_teamId_userId_key" ON "InboxTeamMember"("teamId", "userId");
CREATE INDEX "InboxTeamMember_teamId_idx" ON "InboxTeamMember"("teamId");

CREATE TABLE "AgentState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'online',
    "lastAssignedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentState_organizationId_userId_key" ON "AgentState"("organizationId", "userId");
CREATE INDEX "AgentState_organizationId_idx" ON "AgentState"("organizationId");
