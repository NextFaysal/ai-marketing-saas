import { Module } from "@nestjs/common";
import { AccountingController } from "./accounting.controller";
import { AccountingService } from "./accounting.service";
import { AuditModule } from "../audit/audit.module";

/**
 * NF10 (FB4) — Accounting: chart of accounts + double-entry
 * journal + journal-only reports + bank-statement reconciliation
 * on the EC26 tables. Prisma-only in the codebase's cross-module
 * style (orders / payments / expenses / shipments are read
 * through Prisma, never through their services). Exported so
 * FinanceModule can wire the expense-create forward hook.
 */
@Module({
  imports: [AuditModule],
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
