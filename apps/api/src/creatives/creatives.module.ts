import { Module } from "@nestjs/common";
import { CreativesController } from "./creatives.controller";
import { CreativesService } from "./creatives.service";
import { StorageModule } from "../storage/storage.module";

@Module({ imports: [StorageModule], controllers: [CreativesController], providers: [CreativesService], exports: [CreativesService] })
export class CreativesModule {}
