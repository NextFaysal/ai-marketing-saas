import { Module } from "@nestjs/common";
import { CompetitorsController } from "./competitors.controller";
import { CompetitorsService } from "./competitors.service";
import { LlmFactory } from "../ai/llm/llm.factory";

@Module({ controllers: [CompetitorsController], providers: [CompetitorsService, LlmFactory], exports: [CompetitorsService] })
export class CompetitorsModule {}
