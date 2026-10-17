import { Module } from "@nestjs/common";
import { HrController } from "./hr.controller";
import { HrService } from "./hr.service";
import { AuditModule } from "../audit/audit.module";
import { AccountingModule } from "../accounting/accounting.module";

/**
 * NF11 (FB4) — HR lite. Dependencies ride EXISTING modules
 * only: AuditModule (attendance corrections + payroll actions
 * are audit-logged) and AccountingModule (NF10) — mark-paid
 * posts its ONE journal entry through AccountingService's
 * public createJournalEntry door; AccountingModule does not
 * import this module, so the graph stays acyclic.
 */
@Module({
  imports: [AuditModule, AccountingModule],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
