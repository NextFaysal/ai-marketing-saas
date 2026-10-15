-- CC21/CC23 (Connect Center Next, B10): auto-healing opt-out,
-- payout four-eyes approver, rejected-IPN event record.
--
-- Integration gains `autoHealEnabled` (default true): the
-- CC21 monitoring-sweep auto-healing (commerce webhook
-- re-registration) skips connections whose tenant opted out;
-- detection and alerting are unaffected.
--
-- PayoutRequest gains `approvedById`: the admin who approved
-- the request, persisted at approve time so the CC23 four-eyes
-- rule can refuse a mark-paid by the SAME admin when the
-- walletConfig threshold is set. Pre-existing rows stay NULL —
-- no approver was ever recorded for them, and four-eyes does
-- not apply retroactively.
--
-- TenantPaymentTransaction gains `ipnEvents`: an append-only
-- JSON list of REJECTED gateway notifications (signature
-- invalid / amount mismatch) recorded by the CC23 IPN paths.
-- Before CC23 a rejected IPN left no trace; the CC19 IPN
-- viewer only ever stored VERIFIED payloads (ipnPayload).
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after
-- 20261013440000_su9_su11_collab_health).

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "autoHealEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PayoutRequest" ADD COLUMN "approvedById" TEXT;

-- AlterTable
ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "ipnEvents" JSONB;
