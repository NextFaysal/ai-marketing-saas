-- CRM C5 (Leads & CRM Package): per-org lead auto-assignment
-- setting — strategy (off | round_robin | least_open_leads) plus
-- the round-robin cursor. One row per org; no row = "off"
-- (pre-C5 behaviour: the creator owns a manually created lead,
-- ingested leads stay unassigned).
CREATE TABLE "CrmSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignStrategy" TEXT NOT NULL DEFAULT 'off',
    "rrCursorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmSetting_organizationId_key" ON "CrmSetting"("organizationId");

ALTER TABLE "CrmSetting" ADD CONSTRAINT "CrmSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
