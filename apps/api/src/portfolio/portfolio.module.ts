import { Module } from "@nestjs/common";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioService } from "./portfolio.service";
import { MessagingModule } from "../messaging/messaging.module";

@Module({ imports: [MessagingModule], controllers: [PortfolioController], providers: [PortfolioService], exports: [PortfolioService] })
export class PortfolioModule {}
