-- MX3: Transactional vs Marketing Stream Separation.
-- Additive only, no backfill:
--   MessagingSetting.marketingMaxBroadcastsPerSweep /
--   marketingMaxEntriesPerSweep — per-org caps on how much
--     MARKETING work one broadcast_send_sweep run performs for
--     the org. NULL on every pre-MX3 row = the platform defaults
--     (a total budget of 20 broadcasts per run — up to 10 due +
--     up to 10 stale-recovery, as before — and 200 entries per
--     broadcast per run: exactly the pre-MX3 sweep behaviour).
--   MessagingSetting.quietHoursEnabled / quietHoursStart /
--   quietHoursEnd — the org's marketing quiet window ("HH:mm"
--     strings, validated at the settings write). While the
--     window is active IN THE ORGANIZATION'S TIMEZONE
--     (Organization.timezone), broadcast chunk processing
--     defers: no provider is called for a marketing send and the
--     broadcast simply stays queued for a later sweep.
--     Transactional sends (OrderNotificationService, Shop OTP)
--     never pass through the broadcast engine, so nothing here
--     can defer them.
ALTER TABLE "MessagingSetting" ADD COLUMN "marketingMaxBroadcastsPerSweep" INTEGER;
ALTER TABLE "MessagingSetting" ADD COLUMN "marketingMaxEntriesPerSweep" INTEGER;
ALTER TABLE "MessagingSetting" ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessagingSetting" ADD COLUMN "quietHoursStart" TEXT;
ALTER TABLE "MessagingSetting" ADD COLUMN "quietHoursEnd" TEXT;
