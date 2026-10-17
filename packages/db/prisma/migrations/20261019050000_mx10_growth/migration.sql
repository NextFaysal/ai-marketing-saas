-- MX10: Growth Tools & Preference Center v2.
-- Additive only, no backfill:
--   MessagePreference.topics / maxPerDay — preference-center
--     choices per (channel, address); NULL = pre-MX10 behaviour
--     (no topic restriction, org frequency cap only). The
--     existing `status` column gains a third value, "pending"
--     (double opt-in, unconfirmed) — a String column, no DDL.
--   Broadcast.topic — optional topic tag enforced against the
--     preference topics at resolve time; NULL = untopiced.
--   MessageConsentEvent — consent change history. History
--     BEGINS with this migration: earlier changes were never
--     recorded (MessagePreference flips in place) and are NOT
--     backfilled with invented rows.
--   MessagingOptInForm — messaging-native signup forms (NOT
--     LeadForm, which is the Meta lead-ads builder).
--   MessagingCsvImport — persisted CSV import hygiene reports.
ALTER TABLE "MessagePreference" ADD COLUMN "topics" JSONB;
ALTER TABLE "MessagePreference" ADD COLUMN "maxPerDay" INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN "topic" TEXT;

CREATE TABLE "MessageConsentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "recipientType" TEXT,
    "recipientId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageConsentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessageConsentEvent_organizationId_createdAt_idx" ON "MessageConsentEvent"("organizationId", "createdAt");
CREATE INDEX "MessageConsentEvent_organizationId_address_idx" ON "MessageConsentEvent"("organizationId", "address");

CREATE TABLE "MessagingOptInForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT,
    "description" TEXT,
    "channels" JSONB NOT NULL,
    "topic" TEXT,
    "doubleOptIn" BOOLEAN NOT NULL DEFAULT true,
    "successMessage" TEXT,
    "popup" JSONB,
    "keyword" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingOptInForm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessagingOptInForm_organizationId_slug_key" ON "MessagingOptInForm"("organizationId", "slug");
CREATE INDEX "MessagingOptInForm_organizationId_enabled_idx" ON "MessagingOptInForm"("organizationId", "enabled");

CREATE TABLE "MessagingCsvImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "cleanCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "invalidCount" INTEGER NOT NULL,
    "roleCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingCsvImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessagingCsvImport_organizationId_createdAt_idx" ON "MessagingCsvImport"("organizationId", "createdAt");
