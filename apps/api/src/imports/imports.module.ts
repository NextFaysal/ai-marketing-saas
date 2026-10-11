import { Module } from "@nestjs/common";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";
import { IntegrationsModule } from "../integrations/integrations.module";

// Milestone 65: order imports enter via the integrations upsert.
@Module({ imports: [IntegrationsModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
