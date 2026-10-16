import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OrdersModule } from "../orders/orders.module";
import { FinanceController } from "./finance.controller";
import { FinanceReportsService } from "./finance-reports.service";
import { FinanceService } from "./finance.service";
import { ScheduledReportsService } from "./scheduled-reports.service";

/**
 * GB8 (GC19 + GC20) — reports & finance. Prisma-only services in
 * the codebase's cross-module style (other modules' tables are
 * read through Prisma, never through their services) except two
 * deliberate injections: EmailProvider (the one email door) and
 * OrderProfitService (the ON7 profit computation the scheduled
 * "profit" report and GC20.4 build on — OrdersModule exports it
 * for this module; nothing in OrdersModule imports back here).
 * ScheduledReportsService is exported for the AutomationModule's
 * scheduled_report_sweep job case.
 */
@Module({
  imports: [AuditModule, MessagingModule, OrdersModule],
  controllers: [FinanceController],
  providers: [FinanceReportsService, FinanceService, ScheduledReportsService],
  exports: [ScheduledReportsService, FinanceReportsService, FinanceService],
})
export class FinanceModule {}
