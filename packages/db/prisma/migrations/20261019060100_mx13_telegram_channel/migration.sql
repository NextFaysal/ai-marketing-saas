-- MX13: Telegram as a Messaging broadcast channel.
-- Additive only, no backfill:
--   Broadcast.telegramButtons — the optional inline URL buttons
--     of a telegram broadcast, a validated Json array of
--     [{ label, url }] pairs (label + https URL only — the Bot
--     API's reply_markup.inline_keyboard URL buttons). NULL =
--     every pre-MX13 row and every non-telegram broadcast; the
--     message then carries text only.
--   BroadcastRecipient.telegramChatId — the Telegram chat id a
--     telegram recipient row sends to. One row per chat id. The
--     chat id is ALSO stamped into the row's existing `address`
--     column at prepare time (for telegram the chat id IS the
--     channel address — the preference-store identity), exactly
--     like MX12's push endpoint. NULL on every non-telegram row.
-- The channel columns (Broadcast.channel, MessageDelivery
-- .channel, MessagePreference.channel) are plain Strings and
-- gain the value "telegram" with no DDL.
ALTER TABLE "Broadcast" ADD COLUMN "telegramButtons" JSONB;
ALTER TABLE "BroadcastRecipient" ADD COLUMN "telegramChatId" TEXT;
