-- NF5 (FB3): Multi-language + multi-currency storefront.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). Two new org-scoped tables only:
-- ContentTranslation (product / storefront-string translations;
-- the public storefront serves status = 'approved' rows ONLY —
-- drafts are never public, missing rows fall back to the base
-- text) and DisplayCurrencyRate (a HUMAN-ENTERED display-only
-- FX rate with a required source note; no live rate is ever
-- fetched, and checkout/orders/payments never read this table).

CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'human',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisplayCurrencyRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "ratePerUnit" TEXT NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisplayCurrencyRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentTranslation_organizationId_entityType_entityId_field_locale_key" ON "ContentTranslation"("organizationId", "entityType", "entityId", "field", "locale");
CREATE INDEX "ContentTranslation_organizationId_entityType_locale_idx" ON "ContentTranslation"("organizationId", "entityType", "locale");
CREATE INDEX "ContentTranslation_organizationId_entityId_idx" ON "ContentTranslation"("organizationId", "entityId");

CREATE UNIQUE INDEX "DisplayCurrencyRate_organizationId_currency_key" ON "DisplayCurrencyRate"("organizationId", "currency");
CREATE INDEX "DisplayCurrencyRate_organizationId_idx" ON "DisplayCurrencyRate"("organizationId");

ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisplayCurrencyRate" ADD CONSTRAINT "DisplayCurrencyRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
