import { Module } from "@nestjs/common";
import { AdminSupportController, TenantSupportController } from "./support.controller";
import { SupportService } from "./support.service";

@Module({
  controllers: [TenantSupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
