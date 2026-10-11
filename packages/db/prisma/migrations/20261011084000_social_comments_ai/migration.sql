-- Omnichannel Social Comment Management & AI
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "externalCommentId" TEXT NOT NULL,
    "postTitle" TEXT,
    "postMediaUrl" TEXT,
    "authorName" TEXT NOT NULL,
    "authorAvatarUrl" TEXT,
    "authorSocialId" TEXT,
    "commentText" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "intent" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "isPrivateDmSent" BOOLEAN NOT NULL DEFAULT false,
    "privateDmText" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialComment_organizationId_externalCommentId_key" ON "SocialComment"("organizationId", "externalCommentId");
CREATE INDEX "SocialComment_organizationId_platform_status_idx" ON "SocialComment"("organizationId", "platform", "status");
CREATE INDEX "SocialComment_organizationId_externalPostId_idx" ON "SocialComment"("organizationId", "externalPostId");

CREATE TABLE "SocialReplySetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "aiAutoReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sendPrivateDm" BOOLEAN NOT NULL DEFAULT true,
    "autoHideSpam" BOOLEAN NOT NULL DEFAULT true,
    "replyDelaySeconds" INTEGER NOT NULL DEFAULT 25,
    "tonePreference" TEXT NOT NULL DEFAULT 'FRIENDLY_SALES',
    "bannedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salesOrderUrl" TEXT,
    "freeDeliveryThresholdMinor" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialReplySetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialReplySetting_organizationId_key" ON "SocialReplySetting"("organizationId");
CREATE INDEX "SocialReplySetting_organizationId_idx" ON "SocialReplySetting"("organizationId");
