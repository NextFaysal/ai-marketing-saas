import { Module } from "@nestjs/common";
import { FeedsService } from "./feeds.service";
import { FeedsPublicController, FeedsStaffController } from "./feeds.controller";
import { AuditModule } from "../audit/audit.module";

/** EC14 product feeds. Self-contained: reads products/org data
 * through Prisma and serves the public token URL itself. */
@Module({
  imports: [AuditModule],
  controllers: [FeedsStaffController, FeedsPublicController],
  providers: [FeedsService],
  exports: [FeedsService],
})
export class FeedsModule {}
