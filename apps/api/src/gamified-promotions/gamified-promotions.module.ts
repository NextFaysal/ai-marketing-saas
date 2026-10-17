import { Module } from "@nestjs/common";
import {
  GamifiedPromotionsController, GamifiedPromotionsPublicController,
} from "./gamified-promotions.controller";
import { GamifiedPromotionsService } from "./gamified-promotions.service";
import { AuditModule } from "../audit/audit.module";
import { FraudModule } from "../fraud/fraud.module";

/**
 * NF6 (FB3) — Gamified promotions. Dependencies ride EXISTING
 * modules only: FraudModule exports BlockedPhoneService (the
 * Fraud Shield blocklist the play/join phone gate consults).
 * Prizes are issued as StoreDiscount rows through Prisma
 * directly — the same create the existing coupon issuers
 * (DiscountsService / AbandonedCheckoutsService) perform — so
 * no commerce import cycle is introduced and checkout keeps
 * honouring the codes through its one existing path.
 */
@Module({
  imports: [AuditModule, FraudModule],
  controllers: [GamifiedPromotionsController, GamifiedPromotionsPublicController],
  providers: [GamifiedPromotionsService],
  exports: [GamifiedPromotionsService],
})
export class GamifiedPromotionsModule {}
