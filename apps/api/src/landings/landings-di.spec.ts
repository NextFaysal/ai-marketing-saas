import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { LandingsModule } from "./landings.module";
import { LandingsService } from "./landings.service";
import { StorefrontService } from "../storefront/storefront.service";
import { DiscountsService } from "../commerce/discounts.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { InventoryService } from "../inventory/inventory.service";
import { ProductReviewsService } from "../orders/product-reviews.service";
import { PrismaService } from "../prisma/prisma.service";

describe("EC13 module graph (Landings)", () => {
  it("resolves LandingsService with all collaborators injected", async () => {
    const fakePrisma: any = { auditLog: { create: jest.fn(async () => ({})) } };

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, LandingsModule] })
    class RootModule {}

    const ctx = await NestFactory.createApplicationContext(RootModule, { logger: false });
    try {
      const svc = ctx.get(LandingsService);
      expect(svc).toBeInstanceOf(LandingsService);
      expect((svc as any).storefront).toBeInstanceOf(StorefrontService);
      expect((svc as any).discounts).toBeInstanceOf(DiscountsService);
      expect((svc as any).integrations).toBeInstanceOf(IntegrationsService);
      expect((svc as any).inventory).toBeInstanceOf(InventoryService);
      expect((svc as any).reviews).toBeInstanceOf(ProductReviewsService);
    } finally {
      await ctx.close();
    }
  });
});
