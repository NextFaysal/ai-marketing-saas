import { Module } from "@nestjs/common";
import { MembershipController } from "./membership.controller";
import { MembershipService } from "./membership.service";
import { StoreCreditService } from "./store-credit.service";
import { AuditModule } from "../audit/audit.module";

/**
 * NF7 (FB3) — Membership tiers + store credit.
 *
 * Dependencies ride EXISTING machinery only: tiers price
 * through the existing PriceListsService (CommerceModule —
 * its priceMapForCustomer reads CustomerTier + the tier-bound
 * PriceList directly, so no import cycle is needed here);
 * credit spends price through the existing
 * PromotionsService.evaluateCheckout from a caller-supplied
 * snapshot, and post through postPlacementSpend after the
 * order exists, exactly like loyalty / gift cards.
 * StoreCreditService is exported so StorefrontModule can wire
 * the checkout spend + the shop-account view.
 */
@Module({
  imports: [AuditModule],
  controllers: [MembershipController],
  providers: [MembershipService, StoreCreditService],
  exports: [MembershipService, StoreCreditService],
})
export class MembershipModule {}
