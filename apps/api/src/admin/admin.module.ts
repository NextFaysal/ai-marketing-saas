
import { Module } from "@nestjs/common";
import { AdminController, PublicStatusController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { SuperAdminGuard } from "../common/super-admin.guard";
import { AutomationModule } from "../automation/automation.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [AutomationModule, IntegrationsModule],
  controllers: [AdminController, PublicStatusController],
  providers: [AdminService, SuperAdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
