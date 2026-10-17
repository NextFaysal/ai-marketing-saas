import { Module } from "@nestjs/common";
import { DarazService } from "./daraz.service";
import { DarazController } from "./daraz.controller";
import { AuditModule } from "../../audit/audit.module";

/** OU3 Daraz channel (development adapter + sealed per-org
 * config). Self-contained over the existing Integration models. */
@Module({
  imports: [AuditModule],
  controllers: [DarazController],
  providers: [DarazService],
  exports: [DarazService],
})
export class DarazModule {}
