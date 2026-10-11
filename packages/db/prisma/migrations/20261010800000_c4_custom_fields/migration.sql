-- CRM C4 (Leads & CRM Package): per-org custom field definitions for
-- leads and customers. Values live only in the new JSONB columns on
-- Lead/Customer (keyed by CustomFieldDef.key) — no per-field columns.
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDef_organizationId_entity_key_key" ON "CustomFieldDef"("organizationId", "entity", "key");
CREATE INDEX "CustomFieldDef_organizationId_entity_idx" ON "CustomFieldDef"("organizationId", "entity");

ALTER TABLE "CustomFieldDef" ADD CONSTRAINT "CustomFieldDef_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD COLUMN "customFields" JSONB;
ALTER TABLE "Customer" ADD COLUMN "customFields" JSONB;
