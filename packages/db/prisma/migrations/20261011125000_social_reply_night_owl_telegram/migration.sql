-- AlterTable
ALTER TABLE "SocialReplySetting" ADD COLUMN "nightOwlEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SocialReplySetting" ADD COLUMN "nightOwlMessage" TEXT;
ALTER TABLE "SocialReplySetting" ADD COLUMN "urgentAlertTelegramEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialReplySetting" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "SocialReplySetting" ADD COLUMN "telegramBotToken" TEXT;
ALTER TABLE "SocialReplySetting" ADD COLUMN "cannedSnippets" JSONB;
