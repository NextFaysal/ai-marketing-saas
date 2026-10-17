-- NF4 (FB2): Service & Appointment business type.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). New org-scoped tables only:
-- ServiceOffering (a bookable service), ServiceStaff (an
-- existing Membership made bookable — no new user table),
-- StaffAvailability (weekly windows, minutes from midnight in
-- the org timezone, weekday 0=Sunday..6=Saturday) and
-- ServiceBooking (one appointment; overlap is enforced in the
-- service inside a transaction, deposits are manual-only
-- quotes — no PaymentVerification is ever created for one).

CREATE TABLE "ServiceOffering" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOffering_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceStaff" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "displayName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceStaff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffAvailability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceStaffId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAvailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceBooking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'storefront',
    "depositRequiredMinor" BIGINT NOT NULL DEFAULT 0,
    "depositState" TEXT NOT NULL DEFAULT 'not_required',
    "reminderSentAt" TIMESTAMP(3),
    "reminderStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceOffering_organizationId_active_idx" ON "ServiceOffering"("organizationId", "active");

CREATE UNIQUE INDEX "ServiceStaff_organizationId_membershipId_key" ON "ServiceStaff"("organizationId", "membershipId");
CREATE INDEX "ServiceStaff_organizationId_active_idx" ON "ServiceStaff"("organizationId", "active");
CREATE INDEX "ServiceStaff_membershipId_idx" ON "ServiceStaff"("membershipId");

CREATE INDEX "StaffAvailability_organizationId_serviceStaffId_weekday_idx" ON "StaffAvailability"("organizationId", "serviceStaffId", "weekday");
CREATE INDEX "StaffAvailability_serviceStaffId_idx" ON "StaffAvailability"("serviceStaffId");

CREATE INDEX "ServiceBooking_organizationId_staffId_startAt_idx" ON "ServiceBooking"("organizationId", "staffId", "startAt");
CREATE INDEX "ServiceBooking_organizationId_status_startAt_idx" ON "ServiceBooking"("organizationId", "status", "startAt");
CREATE INDEX "ServiceBooking_organizationId_customerId_idx" ON "ServiceBooking"("organizationId", "customerId");
CREATE INDEX "ServiceBooking_serviceId_idx" ON "ServiceBooking"("serviceId");
CREATE INDEX "ServiceBooking_staffId_idx" ON "ServiceBooking"("staffId");

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "ServiceOffering_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceStaff" ADD CONSTRAINT "ServiceStaff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceStaff" ADD CONSTRAINT "ServiceStaff_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_serviceStaffId_fkey" FOREIGN KEY ("serviceStaffId") REFERENCES "ServiceStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "ServiceStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
