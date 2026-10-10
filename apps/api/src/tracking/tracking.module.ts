import { Module } from "@nestjs/common";
import { TrackingController } from "./tracking.controller";
import { TrackingService } from "./tracking.service";
import { AttributionModule } from "../attribution/attribution.module";
@Module({ imports: [AttributionModule], controllers: [TrackingController], providers: [TrackingService] })
export class TrackingModule {}
