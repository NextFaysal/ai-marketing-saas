-- MX12: Web Push as a Messaging broadcast channel.
-- Additive only, no backfill:
--   Broadcast.pushUrl — the shop-relative click-through URL of
--     a push broadcast (the shop service worker's payload
--     carries title/body/url only — no image, no action
--     buttons, no icon — so those are deliberately NOT columns
--     here). NULL = every pre-MX12 row and every non-push
--     broadcast; the notification then opens the shop root.
--   BroadcastRecipient.pushSubscriptionId — the
--     WebPushSubscription a push recipient row sends to. One
--     row per subscription, so a customer with two subscribed
--     devices receives on both. The endpoint is stamped into
--     the row's existing `address` column at prepare time (for
--     push the endpoint IS the channel address). NULL on every
--     non-push row.
-- The channel columns (Broadcast.channel, MessageDelivery
-- .channel, MessagePreference.channel) are plain Strings and
-- gain the value "push" with no DDL.
ALTER TABLE "Broadcast" ADD COLUMN "pushUrl" TEXT;
ALTER TABLE "BroadcastRecipient" ADD COLUMN "pushSubscriptionId" TEXT;
