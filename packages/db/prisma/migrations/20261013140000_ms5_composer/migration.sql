-- MS5: Composer v2.
-- Additive only:
--   MessageTemplate.htmlBody / Broadcast.htmlBody — the optional
--     HTML part of an email template / broadcast (email channel
--     only; the service rejects htmlBody on sms/whatsapp with an
--     honest 400). NULL (every existing row) = text-only sends,
--     exactly as before. Content is merchant-authored and sent to
--     the provider as authored — no server-side rewriting.
--   MessagingSetting.linkTrackingEnabled — per-org link tracking
--     switch for BROADCAST sends, default true. ON: links in
--     email/sms broadcast bodies gain UTM parameters and are
--     wrapped in the signed public redirect. OFF: links are sent
--     exactly as authored on every channel (no UTM, no wrap).
--   MessageLinkClick — one row per real click on a tracked
--     broadcast link, written only by the public redirect
--     endpoint after its signed token verifies.
ALTER TABLE "MessageTemplate" ADD COLUMN "htmlBody" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "htmlBody" TEXT;
ALTER TABLE "MessagingSetting" ADD COLUMN "linkTrackingEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "MessageLinkClick" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLinkClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageLinkClick_organizationId_broadcastId_idx" ON "MessageLinkClick"("organizationId", "broadcastId");
CREATE INDEX "MessageLinkClick_organizationId_createdAt_idx" ON "MessageLinkClick"("organizationId", "createdAt");
