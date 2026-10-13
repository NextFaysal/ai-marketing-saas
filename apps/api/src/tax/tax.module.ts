import { Module } from "@nestjs/common";
import { TaxController, InvoiceController } from "./tax.controller";
import { TaxService } from "./tax.service";
import { InvoicesService } from "./invoices.service";
import { AccountingService } from "./accounting.service";
import { AuditModule } from "../audit/audit.module";

/** EC23 — Tax & Accounting: org TaxSetting API, fiscal invoice
 * numbering (InvoiceCounter sequence) and accounting CSV exports. */
@Module({
  imports: [AuditModule],
  controllers: [TaxController, InvoiceController],
  providers: [TaxService, InvoicesService, AccountingService],
  exports: [TaxService, InvoicesService, AccountingService],
})
export class TaxModule {}
