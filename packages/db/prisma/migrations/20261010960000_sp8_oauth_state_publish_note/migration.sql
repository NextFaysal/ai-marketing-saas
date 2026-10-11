-- Social Media Post Scheduler SP8 (TikTok) + SP9 (YouTube):
-- 1) SocialOAuthState — DB-backed, single-use, 10-minute OAuth
--    handshake state for the operator-app platforms (TikTok /
--    YouTube). The row id is the unguessable `state` value; the
--    SP9 channel-picker step stores its SEALED token bundle in
--    payload (tokens never sit here in plaintext).
-- 2) SocialPost.publishNote — an honest platform-state note that
--    travels WITH a successful hand-off: TikTok inbox mode is
--    "sent to creator", NOT published, and a YouTube upload from
--    an unverified app is locked Private by YouTube. The note is
--    what the UI shows verbatim next to those posts; null for
--    plain Meta publishes, where published means published.

-- CreateTable
CREATE TABLE "SocialOAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'connect',
    "payload" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialOAuthState_organizationId_idx" ON "SocialOAuthState"("organizationId");

-- CreateIndex
CREATE INDEX "SocialOAuthState_expiresAt_idx" ON "SocialOAuthState"("expiresAt");

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "publishNote" TEXT;
