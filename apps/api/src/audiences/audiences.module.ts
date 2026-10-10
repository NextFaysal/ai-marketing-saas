import { Module } from "@nestjs/common";
import { AudiencesController } from "./audiences.controller";
import { AudiencesService } from "./audiences.service";

@Module({ controllers: [AudiencesController], providers: [AudiencesService], exports: [AudiencesService] })
export class AudiencesModule {}
