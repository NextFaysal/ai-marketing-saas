import { Module } from "@nestjs/common";
import { DataExportsController } from "./data-exports.controller";
import { DataExportsService } from "./data-exports.service";

/**
 * AB8 (AX25) — Merchant Data Tools. Leaf module: PrismaModule and
 * AuditModule are global, so no imports are needed.
 * AutomationModule imports this module for the
 * `data_export_generate` + `org_backup_sweep` jobs; nothing here
 * imports AutomationModule back, so the graph stays acyclic.
 * (Registered in AppModule by the coordinator — this module does
 * not edit app.module.ts.)
 */
@Module({
  controllers: [DataExportsController],
  providers: [DataExportsService],
  exports: [DataExportsService],
})
export class DataToolsModule {}
