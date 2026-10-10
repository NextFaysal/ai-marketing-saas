import { Module } from "@nestjs/common";
import { AttributionController } from "./attribution.controller";
import { AttributionService } from "./attribution.service";
@Module({ controllers: [AttributionController], providers: [AttributionService], exports: [AttributionService] })
export class AttributionModule {}
