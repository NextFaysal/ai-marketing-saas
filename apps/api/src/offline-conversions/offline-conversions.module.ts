import { Module } from "@nestjs/common";
import { OfflineConversionsController } from "./offline-conversions.controller";
import { OfflineConversionsService } from "./offline-conversions.service";

@Module({ controllers: [OfflineConversionsController], providers: [OfflineConversionsService], exports: [OfflineConversionsService] })
export class OfflineConversionsModule {}
