-- MX6: Two-way & Interactive Campaigns (keyword rules + polls).
-- Additive only, two new tables, no backfill:
--   MessagingKeywordRule — org-authored inbound-reply rules.
--     kind "keyword": one exact whole-message keyword (matching
--     normalized exactly like the MS2 STOP/START hook). The
--     reserved STOP/START keyword sets can never be claimed by a
--     rule (the service refuses them): opt-out/opt-in bookkeeping
--     stays exclusive and supreme, and campaign matching never
--     runs for a STOP/START message. kind "poll": pollOptions
--     [{ key, label, keywords }] — a matching inbound message is
--     one vote. Actions (keyword rules only): ONE tag string
--     applied to the entities in applyTagTo (customer | lead |
--     conversation) and/or an org-authored plain-text auto-reply
--     sent through the real inbox conversation send path.
--     channel is "whatsapp" only in v1 — the only channel with
--     an inbound path into messaging.
--   MessagingKeywordHit — ONE row per inbound message that
--     matched a rule or a poll option (non-matching chatter
--     writes no row). actions carries the per-action outcome
--     (applied | skipped | failed + the real reason). The
--     classification fields are an AI SUGGESTION workflow: a
--     suggestion is stored on classify; a human confirm stores
--     confirmedLabel — and an "opt-out" confirm NEVER writes a
--     MessagePreference (suppression is the real STOP path only).
CREATE TABLE "MessagingKeywordRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "keyword" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "tag" TEXT,
    "applyTagTo" JSONB,
    "autoReplyText" TEXT,
    "pollOptions" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingKeywordRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessagingKeywordRule_organizationId_enabled_idx" ON "MessagingKeywordRule"("organizationId", "enabled");

CREATE TABLE "MessagingKeywordHit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "matchedText" TEXT NOT NULL,
    "matchedKeyword" TEXT NOT NULL,
    "pollOptionKey" TEXT,
    "actions" JSONB,
    "suggestedLabel" TEXT,
    "classifyStatus" TEXT,
    "confirmedLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingKeywordHit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessagingKeywordHit_organizationId_ruleId_createdAt_idx" ON "MessagingKeywordHit"("organizationId", "ruleId", "createdAt");
CREATE INDEX "MessagingKeywordHit_organizationId_conversationId_idx" ON "MessagingKeywordHit"("organizationId", "conversationId");
