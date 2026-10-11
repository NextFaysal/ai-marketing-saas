import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { CustomFieldsController } from "./custom-fields.controller";
import { CustomFieldsService } from "./custom-fields.service";
import { LeadAssignmentService } from "./lead-assignment.service";
import { CrmReportController } from "./crm-report.controller";

// CRM C4: CustomFieldsService is exported so CustomersModule can
// validate customer values through the same gate.
// CRM C5: LeadAssignmentService is exported so InboxModule can
// run the same auto-assignment for the leads its ingestion
// paths create directly (Meta leadgen, first message, webchat).
// CRM C6: CrmReportController serves the lead funnel report.
@Module({
  controllers: [LeadsController, CustomFieldsController, CrmReportController],
  providers: [LeadsService, CustomFieldsService, LeadAssignmentService],
  exports: [LeadsService, CustomFieldsService, LeadAssignmentService],
})
export class CrmModule {}
