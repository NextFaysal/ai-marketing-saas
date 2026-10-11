-- CX4: Handover queue polish — escalation reason + waiting clock
-- as real fields on ChannelConversation (handoverReason /
-- handoverAt, written by escalateAutopilot), and timed assignment
-- (assignedAt / assignedUntil / assignmentKind) so the
-- handover_timer_sweep can return an expired timed assignment to
-- the AI when the assignee never replied.
-- This migration carries the WHOLE CX Batch 2 field set:
--   CX5 rides along: ChannelConversation.snoozedUntil (snooze).
--   CX11ac rides along: ChannelMessage.sentWithAiAssist +
--   quickReplyId (reply attribution), QuickReply.timesUsed
--   (quick-reply usage counter), MessageDraft.sentEdited
--   (AI draft sent after editing).
-- All additive; existing rows keep NULL / default values.
ALTER TABLE "ChannelConversation" ADD COLUMN "handoverReason" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "handoverAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "assignedUntil" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "assignmentKind" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "snoozedUntil" TIMESTAMP(3);

ALTER TABLE "ChannelMessage" ADD COLUMN "sentWithAiAssist" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelMessage" ADD COLUMN "quickReplyId" TEXT;

ALTER TABLE "QuickReply" ADD COLUMN "timesUsed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MessageDraft" ADD COLUMN "sentEdited" BOOLEAN NOT NULL DEFAULT false;
