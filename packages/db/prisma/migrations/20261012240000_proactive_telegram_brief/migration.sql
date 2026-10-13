-- AP6 (Proactive++): Telegram copy of the daily AI briefing.
-- Additive columns on AIProactiveSetting; both default to off/empty
-- so existing orgs are unaffected until the owner opts in.
ALTER TABLE "AIProactiveSetting" ADD COLUMN "telegramBriefEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AIProactiveSetting" ADD COLUMN "telegramBriefChatId" TEXT;
