-- NF11 (FB4): HR lite — salary profiles, attendance, shift
-- roster, leave and payroll runs, all hanging off the EXISTING
-- Membership rows (staff ARE Membership/User — no parallel
-- people table). Money is BIGINT minor units.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style).
--
-- HrSetting stores the org's payroll rules EXPLICITLY
-- (unpaidLeaveRule = "per_calendar_day", commissionRule =
-- "recorded_order_commission") — every PayrollRun snapshots
-- the rules + inputs it used. PayrollRun is unique per
-- (organizationId, year, month); a paid run is immutable in
-- the service. Mark-paid is a RECORD, not a money movement;
-- it posts ONE NF10 journal entry (sourceType = "payroll_run")
-- Dr Expense: Salary / Cr Cash when the run total is > 0.

CREATE TABLE "HrSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unpaidLeaveRule" TEXT NOT NULL DEFAULT 'per_calendar_day',
    "commissionRule" TEXT NOT NULL DEFAULT 'recorded_order_commission',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffSalaryProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "baseSalaryMinor" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "payoutNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffSalaryProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'self',
    "correctionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffShiftPattern" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffShiftPattern_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "paid" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ruleSnapshot" JSONB NOT NULL,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "baseMinor" BIGINT NOT NULL DEFAULT 0,
    "unpaidLeaveDays" INTEGER NOT NULL DEFAULT 0,
    "deductionMinor" BIGINT NOT NULL DEFAULT 0,
    "commissionMinor" BIGINT NOT NULL DEFAULT 0,
    "adjustments" JSONB,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrSetting_organizationId_key" ON "HrSetting"("organizationId");
CREATE UNIQUE INDEX "StaffSalaryProfile_membershipId_key" ON "StaffSalaryProfile"("membershipId");
CREATE INDEX "StaffSalaryProfile_organizationId_idx" ON "StaffSalaryProfile"("organizationId");
CREATE UNIQUE INDEX "AttendanceRecord_organizationId_membershipId_date_key" ON "AttendanceRecord"("organizationId", "membershipId", "date");
CREATE INDEX "AttendanceRecord_organizationId_date_idx" ON "AttendanceRecord"("organizationId", "date");
CREATE INDEX "StaffShiftPattern_organizationId_membershipId_weekday_idx" ON "StaffShiftPattern"("organizationId", "membershipId", "weekday");
CREATE INDEX "StaffShiftPattern_membershipId_idx" ON "StaffShiftPattern"("membershipId");
CREATE INDEX "LeaveRequest_organizationId_status_idx" ON "LeaveRequest"("organizationId", "status");
CREATE INDEX "LeaveRequest_organizationId_membershipId_idx" ON "LeaveRequest"("organizationId", "membershipId");
CREATE UNIQUE INDEX "PayrollRun_organizationId_year_month_key" ON "PayrollRun"("organizationId", "year", "month");
CREATE INDEX "PayrollRun_organizationId_status_idx" ON "PayrollRun"("organizationId", "status");
CREATE UNIQUE INDEX "PayrollLine_runId_membershipId_key" ON "PayrollLine"("runId", "membershipId");
CREATE INDEX "PayrollLine_organizationId_membershipId_idx" ON "PayrollLine"("organizationId", "membershipId");

ALTER TABLE "HrSetting" ADD CONSTRAINT "HrSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffSalaryProfile" ADD CONSTRAINT "StaffSalaryProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffSalaryProfile" ADD CONSTRAINT "StaffSalaryProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffShiftPattern" ADD CONSTRAINT "StaffShiftPattern_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffShiftPattern" ADD CONSTRAINT "StaffShiftPattern_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
