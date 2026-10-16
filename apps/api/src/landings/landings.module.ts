import { Module } from "@nestjs/common";
import { createRequire } from "node:module";
import { LandingsService, PRODUCT_REVIEWS_SERVICE } from "./landings.service";
import { LandingsStaffController } from "./landings.controller";
import { LandingsPublicController } from "./landings-public.controller";
import { AuditModule } from "../audit/audit.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CommerceModule } from "../commerce/commerce.module";
import { StorefrontModule } from "../storefront/storefront.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AffiliatesModule } from "../affiliates/affiliates.module";
import { PrismaService } from "../prisma/prisma.service";
import { FraudModule } from "../fraud/fraud.module";
import { ConnectionsModule } from "../connections/connections.module";

const nodeRequire = createRequire(__filename);

/**
 * EC13 landing pages & funnel builder.
 *
 * Imports: StorefrontModule (StorefrontService.matchZone),
 * CommerceModule (DiscountsService), IntegrationsModule
 * (IntegrationsService.upsertOrder), InventoryModule
 * (InventoryService.applyOrderPlaced for the upsell line). None of
 * those modules import this one — the graph stays acyclic.
 *
 * ProductReviewsService (EC15) is wired through the
 * PRODUCT_REVIEWS_SERVICE token with a LAZY factory: the EC15
 * service file is built in parallel, so this module must not
 * statically import it. When the file exists it is instantiated
 * with the (global) PrismaService; when it does not — or its
 * constructor needs more than Prisma — the token resolves to
 * null and LandingsService serves the honest empty reviews block.
 */
@Module({
  imports: [AuditModule, IntegrationsModule, CommerceModule, StorefrontModule, InventoryModule, AffiliatesModule, FraudModule, ConnectionsModule],
  controllers: [LandingsStaffController, LandingsPublicController],
  providers: [
    LandingsService,
    {
      provide: PRODUCT_REVIEWS_SERVICE,
      useFactory: (prisma: PrismaService) => {
        try {
          const mod = nodeRequire("../orders/product-reviews.service");
          const Cls = mod?.ProductReviewsService;
          if (!Cls) return null;
          return new Cls(prisma);
        } catch {
          return null;
        }
      },
      inject: [PrismaService],
    },
  ],
  exports: [LandingsService],
})
export class LandingsModule {}
