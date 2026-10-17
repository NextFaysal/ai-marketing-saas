-- NF15 (FB5): Agency / reseller console — commission RECORDS only.
-- AgencyCommissionEntry records that an agency org earned
-- commission from a client org for a period. There is NO agency
-- entity: an "agency" is a user with memberships in multiple
-- orgs. Recording an entry moves NO money — no wallet table is
-- touched and no payout is executed; payouts remain behind the
-- OU11 legal gate. Money is BIGINT minor units (paisa).
-- Hand-written to match schema.prisma exactly.

CREATE TABLE "AgencyCommissionEntry" (
    "id" TEXT NOT NULL,
    "agencyOrganizationId" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyCommissionEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgencyCommissionEntry_agencyOrganizationId_createdAt_idx" ON "AgencyCommissionEntry"("agencyOrganizationId", "createdAt");
CREATE INDEX "AgencyCommissionEntry_clientOrganizationId_idx" ON "AgencyCommissionEntry"("clientOrganizationId");

ALTER TABLE "AgencyCommissionEntry" ADD CONSTRAINT "AgencyCommissionEntry_agencyOrganizationId_fkey" FOREIGN KEY ("agencyOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyCommissionEntry" ADD CONSTRAINT "AgencyCommissionEntry_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
