import { Module } from "@nestjs/common";
import { AdminSupportController, TenantSupportController } from "./support.controller";
import { SupportService } from "./support.service";
import { AiModule } from "../ai/ai.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AiModule, AuditModule],
  controllers: [TenantSupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
