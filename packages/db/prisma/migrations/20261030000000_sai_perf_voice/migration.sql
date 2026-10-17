-- SA-B5 (Smart AI Phase 0, P7/P8): performance learning, brand
-- voice, customer memory — three new tables, additive only.
--
-- PerformanceSnapshot (P7): deterministic per-period aggregates
-- computed from live rows (inbox outcomes, orders, ads metrics,
-- broadcasts, social posts). INTERNAL class (plan law L3) —
-- served only to the internal Brain audience. One row per
-- (organization, period); recomputation upserts the same key.
--
-- AiBrandVoiceProfile (P8a): the org's learned speaking style,
-- summarised from its staff's own sent messages (PII-masked)
-- behind the D4 conversation-learning opt-in. A suggestion
-- until a human activates it (D3); a re-learn while active
-- waits in the pending columns, never silently replacing the
-- live traits.
--
-- CustomerMemory (P8b): per-customer commerce facts (language
-- observed, products asked/bought, order count), keyed by the
-- conversation identity "<channel>:<externalContactId>".
-- CUSTOMER-OWN class (L3) — served only inside that customer's
-- own conversation context. Written deterministically, no LLM,
-- no inferred traits.

CREATE TABLE "PerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformanceSnapshot_organizationId_periodStart_periodEnd_key" ON "PerformanceSnapshot"("organizationId", "periodStart", "periodEnd");
CREATE INDEX "PerformanceSnapshot_organizationId_periodEnd_idx" ON "PerformanceSnapshot"("organizationId", "periodEnd");

ALTER TABLE "PerformanceSnapshot" ADD CONSTRAINT "PerformanceSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiBrandVoiceProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "traits" JSONB NOT NULL,
    "exampleSnippets" JSONB NOT NULL DEFAULT '[]',
    "pendingTraits" JSONB,
    "pendingExamples" JSONB,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBrandVoiceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiBrandVoiceProfile_organizationId_key" ON "AiBrandVoiceProfile"("organizationId");

ALTER TABLE "AiBrandVoiceProfile" ADD CONSTRAINT "AiBrandVoiceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomerMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerKey" TEXT NOT NULL,
    "displayName" TEXT,
    "languagePref" TEXT,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMP(3),
    "notes" JSONB NOT NULL DEFAULT '[]',
    "lastInteractionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerMemory_organizationId_customerKey_key" ON "CustomerMemory"("organizationId", "customerKey");
CREATE INDEX "CustomerMemory_organizationId_lastInteractionAt_idx" ON "CustomerMemory"("organizationId", "lastInteractionAt");

ALTER TABLE "CustomerMemory" ADD CONSTRAINT "CustomerMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
