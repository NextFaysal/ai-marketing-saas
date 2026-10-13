import { Module } from "@nestjs/common";
import { InstallmentsController } from "./installments.controller";
import { InstallmentsService } from "./installments.service";
import { AuditModule } from "../audit/audit.module";
import { StorefrontModule } from "../storefront/storefront.module";

/**
 * EC31 — installment plans. StorefrontModule provides the
 * shared ShopAccountService.sendShopSms helper for due
 * reminders; it never imports this module, so the graph stays
 * acyclic. AutomationModule imports this module for the
 * installment_due_sweep job.
 */
@Module({
  imports: [AuditModule, StorefrontModule],
  controllers: [InstallmentsController],
  providers: [InstallmentsService],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
