import { Module } from "@nestjs/common";
import { AffiliatesController } from "./affiliates.controller";
import { AffiliatesService } from "./affiliates.service";
import { AuditModule } from "../audit/audit.module";

/**
 * EC32 — affiliate program. Leaf module: PrismaModule is global
 * and EventsModule is global, so the service's constructor
 * injections resolve without imports beyond AuditModule.
 * StorefrontModule / LandingsModule / ProductsModule import this
 * module for the failure-isolated checkout attribution stamp;
 * none of those modules is imported here, so the graph stays
 * acyclic.
 */
@Module({
  imports: [AuditModule],
  controllers: [AffiliatesController],
  providers: [AffiliatesService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}
