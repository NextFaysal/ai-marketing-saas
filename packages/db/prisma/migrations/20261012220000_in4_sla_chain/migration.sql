-- IN4: Layered SLA policy + active escalation chain.
-- Additive only: new nullable/defaulted columns on InboxSetting
-- and ChannelConversation, no changes to existing columns, no
-- backfill. Existing rows read exactly as before: slaByChannel /
-- slaVipMinutes NULL means the org's single
-- slaFirstResponseMinutes applies to every conversation (the
-- pre-IN4 behaviour), the lead alert defaults ON (notifications
-- only), auto-reassign defaults OFF, and the chain markers start
-- NULL (not fired).
ALTER TABLE "InboxSetting" ADD COLUMN "slaByChannel" JSONB;
ALTER TABLE "InboxSetting" ADD COLUMN "slaVipMinutes" INTEGER;
ALTER TABLE "InboxSetting" ADD COLUMN "slaEscalateAfterMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "InboxSetting" ADD COLUMN "slaLeadAlertEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InboxSetting" ADD COLUMN "slaAutoReassignEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ChannelConversation" ADD COLUMN "slaWarnedAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "slaLeadAlertedAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "slaAutoReassignedAt" TIMESTAMP(3);
