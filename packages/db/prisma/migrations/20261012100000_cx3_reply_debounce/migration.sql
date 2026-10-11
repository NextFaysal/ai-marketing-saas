-- CX3: Wait-before-answering (debounce) — per-org inbox AI reply
-- delay (+ per-channel overrides), pending deferred-reply markers
-- on conversations, and due/batch markers on social comments so
-- the already-existing SocialReplySetting.replyDelaySeconds can
-- finally take effect.
ALTER TABLE "InboxSetting" ADD COLUMN "aiReplyDelaySeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InboxSetting" ADD COLUMN "aiReplyDelayByChannel" JSONB;

ALTER TABLE "ChannelConversation" ADD COLUMN "autoReplyDueAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "autoReplyBatchSince" TIMESTAMP(3);

ALTER TABLE "SocialComment" ADD COLUMN "aiReplyDueAt" TIMESTAMP(3);
ALTER TABLE "SocialComment" ADD COLUMN "aiReplyBatchOf" TEXT;
